"""Cassette look pass: two-part label and photographic materials (work package B).

Run headless on the phase 0 cassette (after make_label_decals.py):
    /Applications/Blender.app/Contents/MacOS/Blender -b art-src/mixtape/cassette_base.blend \
        --python scripts/mixtape/lookdev_cassette.py

Reuses the cassette in cassette_base.blend as is (shell, hubs, packs, camera, lights);
nothing is rebuilt. Changes:
- replaces the full-face 87 x 45 mm `Label` with `Label_Strip` (87 x 17.6 mm above the
  window, carrying the SVG decal) and `Label_Band` (87 x 6.3 mm, plain paper below the
  window). One material per brand x label style and one band material per brand.
- materials pass: shells get plastic grain, texture-driven roughness and a thin clear
  coat; the window picks up faint scuffs; hubs darker with AO; screws metallic; tape
  pack glossier. Shell_White and Shell_Clear are added for the Sony and BASF tapes.

Writes art-src/mixtape/cassette_look.blend (cassette_base.blend is left untouched).
"""

import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_cassette as BC  # noqa: E402
import label_layout as LL  # noqa: E402
import mixtape_common as MC  # noqa: E402

T = MC.TEX


def label_geometry():
    root = bpy.data.objects["Cassette"]
    old = bpy.data.objects.get("Label")
    if old:
        bpy.data.objects.remove(old)
    obs = {}
    for name, r in (("Label_Strip", LL.STRIP), ("Label_Band", LL.BAND)):
        ob = BC.prism_obj(name, BC.rect_pts(r["x0"], r["y0"], r["x1"], r["y1"]), LL.PAPER_Z0, LL.PAPER_Z1, root)
        obs[name] = ob
    return obs


def label_materials():
    for brand in LL.BRANDS:
        glossy = LL.LOOK[brand]["paper"] == "glossy-white"
        for style in LL.STYLES:
            MC.image_material("Label_%s_%s" % (brand, style), LL.strip_png(brand, style),
                              rough=0.42 if glossy else 0.62, spec=0.35, coat=0.15 if glossy else 0.0)
        MC.image_material("LabelBand_%s" % brand, LL.band_png(brand),
                          rough=0.42 if glossy else 0.62, spec=0.35, coat=0.15 if glossy else 0.0)


def shell_materials():
    P = os.path.join(T, "plastic")
    MC.textured_principled("Shell_Black", (0.014, 0.014, 0.015), tex=os.path.join(P, "black-scratched.png"),
                           tile_mm=45, grain=0.6, rough=0.34, rough_var=0.12, coat=0.25, spec=0.55)
    MC.textured_principled("Shell_White", (0.80, 0.79, 0.75), tex=os.path.join(P, "white-yellowed.png"),
                           tile_mm=55, grain=0.5, rough=0.38, rough_var=0.10, coat=0.2, spec=0.5)
    MC.textured_principled("Shell_Clear", (0.72, 0.74, 0.78), tex=os.path.join(P, "smoked-transparent.png"),
                           tile_mm=70, grain=0.4, rough=0.07, rough_var=0.05, alpha=0.14, coat=0.3, spec=0.7,
                           blend=True)
    MC.textured_principled("Shell_Smoke", (0.06, 0.055, 0.05), tex=os.path.join(P, "smoked-transparent.png"),
                           tile_mm=70, grain=0.4, rough=0.07, rough_var=0.05, alpha=0.45, coat=0.3, spec=0.7,
                           blend=True)
    # Window: nearly clear, faint scuffs raise opacity and roughness.
    for name, col, a in (("Window_Clear", (0.03, 0.03, 0.03), 0.07), ("Window_Smoke", (0.08, 0.075, 0.07), 0.32)):
        mat = MC.textured_principled(name, col, rough=0.04, alpha=a, spec=0.8, blend=True)
        nt = mat.node_tree
        b = nt.nodes["Principled BSDF"]
        _, tx = MC.tex_grain(nt, os.path.join(T, "wear", "scuff-scratch-mask.png"), 40, 1.0)
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(tx.outputs["Color"], bw.inputs["Color"])
        # raw mask 0..1: scratches scatter light, so they turn pale and a bit opaque
        al = nt.nodes.new("ShaderNodeMath")
        al.operation = "MULTIPLY_ADD"
        al.use_clamp = True
        al.inputs[1].default_value = 0.06
        al.inputs[2].default_value = a
        nt.links.new(bw.outputs["Val"], al.inputs[0])
        nt.links.new(al.outputs[0], b.inputs["Alpha"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[6].default_value = (*col, 1.0)
        mix.inputs[7].default_value = (0.55, 0.55, 0.55, 1.0)
        fac = nt.nodes.new("ShaderNodeMath")
        fac.operation = "MULTIPLY"
        fac.inputs[1].default_value = 0.3
        nt.links.new(bw.outputs["Val"], fac.inputs[0])
        nt.links.new(fac.outputs[0], mix.inputs["Factor"])
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
        ro = nt.nodes.new("ShaderNodeMath")
        ro.operation = "MULTIPLY_ADD"
        ro.use_clamp = True
        ro.inputs[1].default_value = 0.25
        ro.inputs[2].default_value = 0.04
        nt.links.new(bw.outputs["Val"], ro.inputs[0])
        nt.links.new(ro.outputs[0], b.inputs["Roughness"])


def part_materials():
    # Hub: darker grey, AO in the teeth and collar so it stops reading flat.
    hub = MC.textured_principled("Hub", (0.36, 0.36, 0.35), tex=os.path.join(T, "plastic", "white-yellowed.png"),
                                 tile_mm=20, grain=0.35, rough=0.42, rough_var=0.08, coat=0.1)
    nt = hub.node_tree
    b = nt.nodes["Principled BSDF"]
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.002
    src = b.inputs["Base Color"].links[0].from_socket
    nt.links.new(src, ao.inputs["Color"])
    nt.links.new(ao.outputs["Color"], b.inputs["Base Color"])
    MC.textured_principled("Screw", (0.66, 0.66, 0.68), rough=0.26, metal=1.0)
    pack = bpy.data.materials["TapePack"]
    pb = pack.node_tree.nodes["Principled BSDF"]
    pb.inputs["Roughness"].default_value = 0.3
    pb.inputs["Specular IOR Level"].default_value = 0.6
    # Rebind every object to the new materials (new_material renamed the old ones).
    for ob in bpy.data.objects:
        if ob.type != "MESH" or not ob.data.materials:
            continue
        m = ob.data.materials[0]
        if m and m.name.endswith("_old"):
            ob.data.materials[0] = bpy.data.materials[m.name[:-4]]
    for m in list(bpy.data.materials):
        if m.name.endswith("_old") or m.name in ("Label_Paper", "Shell_Cream"):
            m.use_fake_user = False
            if m.users == 0:
                bpy.data.materials.remove(m)


def sortable_origins():
    """Give shell and window parts real origins so BLENDED transparency sorts by depth
    (they were built in world coordinates with the origin at the shell centre)."""
    for ob in bpy.data.objects:
        if ob.type == "MESH" and (ob.get("shell_part") or ob.get("window_part")):
            MC.origin_to_center(ob)


def main():
    sc = bpy.context.scene
    obs = label_geometry()
    sortable_origins()
    label_materials()
    shell_materials()
    part_materials()
    MC.assign(obs["Label_Strip"], bpy.data.materials["Label_tdk_printed"])
    MC.assign(obs["Label_Band"], bpy.data.materials["LabelBand_tdk"])
    MC.apply_tape("tdk")
    lay = json.loads(sc["mixtape_layout"])
    lay["label"] = {"strip": LL.STRIP, "band": LL.BAND, "z0": LL.PAPER_Z0, "z1": LL.PAPER_Z1,
                    "svg_scale": LL.SVG_SCALE, "note": "two-part label, see label_layout.py"}
    lay.pop("art_slot", None)
    lay.pop("text", None)
    sc["mixtape_layout"] = json.dumps(lay)
    bpy.ops.wm.save_as_mainfile(filepath=MC.LOOK_BLEND)
    print("MIXTAPE saved", MC.LOOK_BLEND)


if __name__ == "__main__":
    main()
