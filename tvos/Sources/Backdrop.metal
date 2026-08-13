#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Fluid backdrops for Framed Now Playing (FramedBackdrop .marble / .ink):
// SwiftUI layerEffect shaders that domain-warp the blurred album texture so
// the cover's own colors fold and flow. See FluidBackdrop.swift for the host
// view (it overscans the source so warped samples never leave the layer).
//
// Value-noise fbm is computed in-shader (no textures). Time arrives already
// wrapped to a day (float32 precision) and pre-scaled per style.

static float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float vnoise(float2 p) {
    float2 i = floor(p), f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + float2(1, 0));
    float c = hash21(i + float2(0, 1));
    float d = hash21(i + float2(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

static float fbm(float2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p = p * 2.03 + 17.13;
        a *= 0.5;
    }
    return v;
}

// Saturation boost so the flow glows instead of washing out (the source is
// blurred, which desaturates; this restores punch).
static half3 vivid(half3 c, half amount) {
    half luma = dot(c, half3(0.299h, 0.587h, 0.114h));
    return clamp(mix(half3(luma), c, amount), 0.0h, 1.0h);
}

// Paint marbling: the classic two-stage domain warp (Quilez "warp of a warp").
// q and r drift on opposing time phases, so the field continuously folds into
// itself like stirred oil paint. Tuned LOUD (showpiece tier): fast clock, big
// excursions, strong light/dark shading sweeping along the folds - the
// shading bands are what make the motion legible at a glance even where the
// source texture is smooth.
[[ stitchable ]] half4 marbleBackdrop(float2 pos, SwiftUI::Layer layer,
                                      float2 size, float time, float maxOff) {
    float2 uv = pos / size;
    float t = time * 0.16;

    float2 q = float2(fbm(uv * 2.6 + float2(0.0, 0.0) + t * 0.9),
                      fbm(uv * 2.6 + float2(5.2, 1.3) - t));
    float2 r = float2(fbm(uv * 2.6 + 4.0 * q + float2(1.7, 9.2) + 0.45 * t),
                      fbm(uv * 2.6 + 4.0 * q + float2(8.3, 2.8) - 0.35 * t));

    float2 offset = (r - 0.5) * 2.0 * maxOff;
    half4 c = layer.sample(pos + offset);
    // Sweeping fold shading + a moving highlight vein where q and r agree.
    float shade = 0.70 + 0.55 * q.x;
    float vein = smoothstep(0.45, 0.65, q.y * r.x);
    c.rgb *= half(shade);
    c.rgb += half3(half(vein * 0.18));
    c.rgb = vivid(c.rgb, 1.45h);
    return c;
}

// Smoke (ne Ink): strong directional turbulence - the field rises while a
// curl warp (divergence-free, so it billows rather than slides) churns it.
// The layer it warps is a field of palette colors sampled from the cover
// (see FluidBackdrop.paletteField), not the album texture itself - cleaner,
// more graphic billows. Clock halved from the first loud pass per Justin.
[[ stitchable ]] half4 smokeBackdrop(float2 pos, SwiftUI::Layer layer,
                                     float2 size, float time, float maxOff) {
    float2 uv = pos / size;
    float t = time * 0.15;

    // Upward advection of the noise domain (the "rising ink" feel).
    float2 p = uv * 3.0 + float2(0.0, t * 0.7);

    // Curl-ish vector: perpendicular of the fbm gradient.
    float e = 0.06;
    float n  = fbm(p + t * 0.3);
    float nx = fbm(p + float2(e, 0.0) + t * 0.3);
    float ny = fbm(p + float2(0.0, e) + t * 0.3);
    float2 curl = float2((ny - n) / e, -(nx - n) / e);

    // Slower large-scale churn underneath.
    float2 q = float2(fbm(uv * 1.5 - t * 0.45), fbm(uv * 1.5 + float2(3.1, 7.7) + t * 0.35));

    float2 offset = (curl * 0.5 + (q - 0.5) * 1.6) * maxOff;
    half4 c = layer.sample(pos + offset);
    // Smoky tendrils: deep shading bands, plus a fine high-frequency layer
    // that textures the billows (shading only - it adds visible filament
    // detail without changing the flow speed).
    float fine = fbm(p * 2.6 + float2(7.7, 3.3) - t * 0.25);
    float shade = 0.55 + 0.50 * n + 0.25 * fine;
    float crest = smoothstep(0.62, 0.85, fine);
    c.rgb *= half(shade);
    c.rgb += half3(half(crest * 0.20));
    c.rgb = vivid(c.rgb, 1.5h);
    return c;
}

// Caustics: sunlit-pool light webs in the album's colors. Two drifting fbm
// fields interfere; where they agree, bright filaments form (the classic
// cheap caustic: filament = where |n1 - n2| collapses). The web refracts the
// palette field slightly and sparkles white at its brightest knots.
[[ stitchable ]] half4 causticsBackdrop(float2 pos, SwiftUI::Layer layer,
                                        float2 size, float time, float maxOff) {
    float2 uv = pos / size;
    float t = time * 0.35;
    float2 p = uv * 4.5;

    float n1 = fbm(p + float2(t * 0.6, t * 0.2));
    float n2 = fbm(p * 1.13 + float2(-t * 0.5, t * 0.45) + 4.7);
    float d = abs(n1 - n2);
    float web  = pow(saturate(1.0 - d * 2.6), 6.0);   // sharp filaments
    float halo = pow(saturate(1.0 - d * 1.4), 2.0);   // broad soft glow

    half4 base = layer.sample(pos + (n1 - 0.5) * maxOff * 0.6);
    half3 col = base.rgb * (0.30h + 0.25h * half(halo));
    col += base.rgb * half(web) * 1.1h;
    col += half3(half(web * 0.22));                    // white sparkle at knots
    col = vivid(col, 1.45h);
    return half4(col, 1.0h);
}

// Bars: the faux EQ. Honest about having no audio data (Sonos exposes none),
// so instead of faking beat-sync it goes for elegance: smooth bottom-anchored
// bars whose heights ride layered value noise - musical in rhythm and shape,
// never claiming to hear. Bars take their hue from the palette field at
// their own x, so the EQ is always in the album's colors.
[[ stitchable ]] half4 barsBackdrop(float2 pos, SwiftUI::Layer layer,
                                    float2 size, float time, float maxOff) {
    float2 uv = pos / size;
    float t = time;
    const float N = 56.0;

    float xi = floor(uv.x * N);
    float fx = fract(uv.x * N);
    float inBarX = step(0.14, fx) * step(fx, 0.86);

    // Layered noise: slow swells + mid bounce + fast shimmer.
    float n = 0.50 * vnoise(float2(xi * 0.37 + 0.13, t * 1.3))
            + 0.32 * vnoise(float2(xi * 0.91 + 7.70, t * 2.4))
            + 0.18 * vnoise(float2(xi * 1.73 + 3.10, t * 4.2));
    float h = 0.10 + 0.68 * n;          // bar height, fraction of opening
    float yUp = 1.0 - uv.y;             // 0 at the bottom edge

    // Bar hue from the palette field at this bar's center.
    half4 base = layer.sample(float2((xi + 0.5) / N * size.x, size.y * 0.45));

    // Background: the palette field, heavily dimmed.
    half3 col = layer.sample(pos).rgb * 0.12h;

    // Bar body with a vertical gradient (brighter toward its cap).
    float body = step(yUp, h) * inBarX;
    float grad = 0.30 + 0.70 * smoothstep(0.0, max(h, 1e-3), yUp);
    col = mix(col, base.rgb * half(grad), half(body));

    // Soft glow rising off each cap.
    float glow = exp(-max(0.0, yUp - h) * 16.0) * 0.35 * inBarX;
    col += base.rgb * half(glow);

    col = vivid(col, 1.4h);
    return half4(col, 1.0h);
}

// Ripple: the music radiating from the record. Sound-waves expand outward
// from the center (where the cover sits, so they visually emerge from behind
// it), bent organic by low-frequency noise so the rings read as energy, not
// geometry. Each wavefront refracts the palette field (radial displacement),
// catches light on its crest, and carries a subtle prismatic fringe (the
// R/G/B channels sample at slightly different radii - a lens-dispersion
// touch that reads as the wave bending light).
[[ stitchable ]] half4 rippleBackdrop(float2 pos, SwiftUI::Layer layer,
                                      float2 size, float time, float maxOff) {
    float2 uv = pos / size;
    float aspect = size.x / max(size.y, 1.0);
    float2 d = uv - float2(0.5, 0.5);
    d.x *= aspect;
    float r = length(d);
    float t = time;

    // Organic wobble: rings billow instead of staying concentric circles.
    float wob = (fbm(uv * 2.2 + t * 0.04) - 0.5) * 0.10
              + (fbm(uv * 5.0 - t * 0.06) - 0.5) * 0.04;
    float rr = r + wob;

    // Outward-traveling wave train: ~9s for a front to cross the opening.
    float phase = rr * 7.0 - t * 0.55;
    float w = 0.5 + 0.5 * cos(phase * 6.28318);
    float crest = pow(w, 3.0);

    // Amplitude eases in away from dead center and stays inside the layer.
    float amp = smoothstep(0.02, 0.25, r);
    float2 dir = d / max(r, 1e-4);
    dir.x /= aspect;
    float2 off = dir * (crest - 0.35) * maxOff * amp;

    // Prismatic fringe: per-channel radial offsets on the same wavefront.
    half rC = layer.sample(pos + off * 1.18).r;
    half4 g = layer.sample(pos + off);
    half bC = layer.sample(pos + off * 0.82).b;
    half4 c = half4(rC, g.g, bC, g.a);

    c.rgb *= half(0.62 + 0.55 * crest);
    c.rgb += half3(half(pow(crest, 2.0) * 0.22));
    c.rgb = vivid(c.rgb, 1.5h);
    return c;
}
