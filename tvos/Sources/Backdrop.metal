#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Fluid backdrops for Framed Now Playing (FramedBackdrop .marble / .smoke):
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

// Smoke (formerly Ink): strong directional turbulence - the field rises while a
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
