"""Builds Otto, the kit's robot, in Blender and exports web/public/otto/otto.glb.

Run headless:   python -m pip install bpy==5.3.0 && python blender/build_otto.py
Or in Blender:  Scripting tab -> open this file -> Run Script (or send it through Blender MCP's execute_blender_code).

Everything is made from primitives here, so the model is ours. The app animates these named nodes (keep the names if you
remodel):
  EchoRoot                  the whole robot (still named Echo on purpose: the app and existing animations look it up by this name)
  Body                      the short standing body, with its feet
  HeadPivot                 the head turns, nods and bobs around this (at the neck)
    Head, Visor             the big rounded shell and the glossy face glass
    EarL, EarR              the pods on each side of the head
    EyeL, EyeR              rounded-square eyes: the app scales them for blinks and faces
    Mouth0 .. Mouth4        five small light bars under the eyes: the app drives them with Otto's voice (Web Audio)
  HandLPivot, HandRPivot    the stubby arms (think, talk)
  (AntennaPivot, AntennaTip are optional: the app animates them if a model has them.)
Materials: Shell (recoloured by the app), Trim, Visor, Glow (emissive; the app recolours it per face).
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "otto" / "otto.glb"


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name: str, color: tuple[float, float, float], roughness: float, metallic: float = 0.0,
             emission: tuple[float, float, float] | None = None, strength: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def empty(name: str, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.1
    obj.location = location
    obj.parent = parent
    bpy.context.collection.objects.link(obj)
    return obj


def finish(obj, name: str, mat, parent=None, smooth: bool = True, bevel: float = 0.0, subdiv: int = 0):
    obj.name = name
    obj.data.name = name
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "NONE"
    if subdiv:
        mod = obj.modifiers.new("Subdiv", "SUBSURF")
        mod.levels = subdiv
        mod.render_levels = subdiv
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    if parent is not None:
        # Keep the world position while parenting. matrix_world is stale until the view layer updates.
        bpy.context.view_layer.update()
        world = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_world = world
    return obj


def apply_scale(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def capsule(name: str, radius: float, length: float, location, mat, parent=None, rotation=(0, 0, 0)):
    """A pill: a cylinder with sphere caps, joined. Length is along local Z, between the cap centres."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=length, location=(0, 0, 0))
    body = bpy.context.active_object
    parts = [body]
    for z in (length / 2, -length / 2):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=radius, location=(0, 0, z))
        parts.append(bpy.context.active_object)
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.remove_doubles(threshold=0.002)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj = bpy.context.active_object
    obj.location = location
    obj.rotation_euler = rotation
    return finish(obj, name, mat, parent)


def rounded_box(name: str, size, location, mat, parent, bevel: float, segments: int = 5):
    """A box of `size` (x, y, z) with rounded edges, its scale applied so the node itself is unscaled."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.scale = size
    apply_scale(obj)
    finish(obj, name, mat, parent, bevel=bevel)
    obj.modifiers["Bevel"].segments = segments
    return obj


def build() -> None:
    reset()
    # Blender is Z-up and the face looks down -Y; the glTF exporter turns that into Y-up, facing the viewer (+Z).
    shell = material("Shell", (0.2, 0.21, 0.23), roughness=0.62)                # matte graphite
    trim = material("Trim", (0.12, 0.125, 0.14), roughness=0.7)                  # darker graphite
    visor = material("Visor", (0.012, 0.014, 0.018), roughness=0.06, metallic=0.0)  # glossy black glass
    glow = material("Glow", (0.96, 0.95, 0.9), roughness=0.4, emission=(0.96, 0.95, 0.9), strength=3.0)

    root = empty("EchoRoot")

    # Body: a short rounded column that stands on two soft feet.
    body = rounded_box("Body", (0.48, 0.44, 0.6), (0, 0, 0.36), shell, root, bevel=0.14, segments=6)
    for side in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.5, location=(side * 0.12, -0.01, 0.07))
        foot = bpy.context.active_object
        foot.scale = (0.26, 0.36, 0.16)
        apply_scale(foot)
        finish(foot, f"Foot{'L' if side < 0 else 'R'}", shell, body)

    # Head: big, deeper than it is wide, on a pivot at the neck.
    head_pivot = empty("HeadPivot", (0, 0, 0.62), root)
    rounded_box("Head", (1.28, 1.12, 1.0), (0, 0.04, 1.12), shell, head_pivot, bevel=0.32, segments=6)
    # The visor: a glossy black block sunk into the face. It is deep so its big rounded corners fit (a bevel cannot be wider
    # than half the thinnest side); only its front 8 cm stand out of the head.
    rounded_box("Visor", (1.02, 0.6, 0.76), (0, -0.3, 1.11), visor, head_pivot, bevel=0.28, segments=8)

    # Ear pods on both sides.
    for side in (-1, 1):
        rounded_box(f"Ear{'L' if side < 0 else 'R'}", (0.1, 0.34, 0.3), (side * 0.66, 0.06, 1.12), trim, head_pivot, bevel=0.045)

    # Eyes: two rounded squares, set low and close together. Unscaled nodes, so the app's scale is the eye's shape.
    for name, x in (("EyeL", -0.1), ("EyeR", 0.1)):
        rounded_box(name, (0.15, 0.03, 0.17), (x, -0.6, 1.04), glow, head_pivot, bevel=0.035, segments=3)

    # Mouth: five small bars under the eyes, the voice meter. Short at rest, they stretch up to about 3x while Otto talks.
    for i in range(5):
        rounded_box(f"Mouth{i}", (0.028, 0.02, 0.03), ((i - 2) * 0.05, -0.6, 0.88), glow, head_pivot, bevel=0.012, segments=2)

    # Arms: short stubs on the body, each on a pivot at its shoulder.
    for name, side in (("HandL", -1), ("HandR", 1)):
        pivot = empty(f"{name}Pivot", (side * 0.26, 0, 0.5), root)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.5, location=(side * 0.31, -0.02, 0.44))
        hand = bpy.context.active_object
        hand.scale = (0.15, 0.17, 0.2)
        apply_scale(hand)
        finish(hand, name, shell, pivot)

    for obj in bpy.data.objects:
        obj.select_set(False)


def export() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT), export_format="GLB", export_apply=True, export_yup=True,
        export_materials="EXPORT", use_selection=False, export_extras=False,
    )
    size = OUT.stat().st_size
    print(f"Wrote {OUT} ({size / 1024:.0f} KB)")


if __name__ == "__main__":
    build()
    export()
    # Optional: a render to check the model without the app. python build_otto.py --render out.png
    if "--render" in sys.argv:
        target = sys.argv[sys.argv.index("--render") + 1]
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 32
        scene.render.resolution_x, scene.render.resolution_y = 600, 700
        bpy.ops.object.camera_add(location=(2.2, -4.4, 1.6))
        cam = bpy.context.active_object
        cam.data.lens = 50
        direction = Vector((0, 0, 0.9)) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        bpy.ops.object.light_add(type="AREA", location=(2, -3, 4))
        bpy.context.active_object.data.energy = 900
        bpy.ops.object.light_add(type="AREA", location=(-3, -1, 2))
        bpy.context.active_object.data.energy = 300
        world = bpy.data.worlds.new("World")
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.92, 0.96, 1)
        world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
        scene.world = world
        scene.render.filepath = target
        bpy.ops.render.render(write_still=True)
        print(f"Rendered {target}")
