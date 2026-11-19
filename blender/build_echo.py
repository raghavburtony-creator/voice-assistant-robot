"""Builds Echo, the kit's robot, in Blender and exports web/public/echo/echo.glb.

Run headless:   python -m pip install bpy==5.3.0 && python blender/build_echo.py
Or in Blender:  Scripting tab -> open this file -> Run Script (or send it through Blender MCP's execute_blender_code).

Everything is made from primitives here, so the model is ours. The app animates these named nodes (keep the names if you
remodel):
  EchoRoot                  the whole robot
  Body, HoverRing           the floating body and the glowing ring under it
  HeadPivot                 the head turns and nods around this (at the neck)
    Head, Visor             the shell and the dark face glass
    EyeL, EyeR              the eyes: the app scales them for blinks and faces
    Mouth0 .. Mouth4        five light bars: the app drives them with Echo's voice (Web Audio)
    AntennaPivot, AntennaTip
  HandLPivot, HandRPivot    the floating hands (wave, think)
Materials: Shell (recoloured by the app), Trim, Visor, Glow (emissive; the app recolours it per face).
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "echo" / "echo.glb"


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


def build() -> None:
    reset()
    # Blender is Z-up and the face looks down -Y; the glTF exporter turns that into Y-up, facing the viewer (+Z).
    shell = material("Shell", (0.93, 0.42, 0.26), roughness=0.38)            # warm coral, satin
    trim = material("Trim", (0.16, 0.17, 0.22), roughness=0.55, metallic=0.2)  # graphite
    visor = material("Visor", (0.03, 0.035, 0.05), roughness=0.08, metallic=0.1)
    glow = material("Glow", (1.0, 0.78, 0.35), roughness=0.4, emission=(1.0, 0.72, 0.28), strength=4.0)  # amber

    root = empty("EchoRoot")

    # Body: an egg, wider at the top, floating.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=20, radius=0.5, location=(0, 0, 0.62))
    body = bpy.context.active_object
    body.scale = (0.78, 0.7, 0.62)
    apply_scale(body)
    for vert in body.data.vertices:  # taper the lower half
        if vert.co.z < 0:
            k = 1 + vert.co.z * 0.9
            vert.co.x *= k
            vert.co.y *= k
    finish(body, "Body", shell, root)

    # A graphite band round the belly, and the glowing hover ring below.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.36, minor_radius=0.035, major_segments=64, minor_segments=12, location=(0, 0, 0.66))
    band = bpy.context.active_object
    band.scale = (1.07, 0.97, 1)
    finish(band, "BellyBand", trim, root)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.03, major_segments=48, minor_segments=10, location=(0, 0, 0.2))
    finish(bpy.context.active_object, "HoverRing", glow, root)

    # Head: a rounded box on a pivot at the neck, floating a little above the body.
    head_pivot = empty("HeadPivot", (0, 0, 1.0), root)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1.43))
    head = bpy.context.active_object
    head.scale = (1.06, 0.86, 0.78)
    apply_scale(head)
    finish(head, "Head", shell, head_pivot, bevel=0.2, subdiv=1)

    # The visor: a dark rounded slab set into the front.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.385, 1.43))
    face = bpy.context.active_object
    face.scale = (0.82, 0.12, 0.52)
    apply_scale(face)
    finish(face, "Visor", visor, head_pivot, bevel=0.12, subdiv=1)

    # Eyes: two upright pills on the visor. Their origins sit at their centres, so the app can squash them.
    for name, x in (("EyeL", -0.19), ("EyeR", 0.19)):
        eye = capsule(name, 0.055, 0.1, (x, -0.452, 1.5), glow, head_pivot)
        eye.scale = (1, 0.45, 1)

    # Mouth: five short bars, the voice meter.
    for i in range(5):
        x = (i - 2) * 0.075
        bar = capsule(f"Mouth{i}", 0.022, 0.03, (x, -0.452, 1.29), glow, head_pivot)
        bar.scale = (1, 0.5, 1)

    # Antenna: a short stalk on the right of the crown, a glowing ball on top.
    antenna = empty("AntennaPivot", (0.2, 0, 1.8), head_pivot)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.02, depth=0.24, location=(0.2, 0, 1.91))
    finish(bpy.context.active_object, "AntennaStalk", trim, antenna)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.055, location=(0.2, 0, 2.06))
    finish(bpy.context.active_object, "AntennaTip", glow, antenna)

    # Side vents: three short graphite slots on each cheek.
    for side in (-1, 1):
        for j in range(3):
            slot = capsule(f"Vent{'L' if side < 0 else 'R'}{j}", 0.014, 0.09, (side * 0.535, 0, 1.36 + j * 0.07), trim, head_pivot,
                           rotation=(0, math.radians(90), 0))
            slot.scale = (1, 1, 1)

    # Hands: floating mittens, each on a pivot at its shoulder point.
    for name, side in (("HandL", -1), ("HandR", 1)):
        pivot = empty(f"{name}Pivot", (side * 0.46, 0, 0.82), root)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.11, location=(side * 0.56, -0.02, 0.6))
        hand = bpy.context.active_object
        hand.scale = (0.7, 0.85, 1.25)
        apply_scale(hand)
        finish(hand, name, shell, pivot)

    # Centre the robot on its root, feet (the ring) near the floor.
    for obj in bpy.data.objects:
        obj.select_set(False)


def export() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT), export_format="GLB", export_apply=True, export_yup=True,
        export_materials="EXPORT", use_selection=False, export_extras=False,
        export_texcoord=False,  # no textures, so no UVs: a smaller file
    )
    size = OUT.stat().st_size
    print(f"Wrote {OUT} ({size / 1024:.0f} KB)")


if __name__ == "__main__":
    build()
    export()
    # Optional: a render to check the model without the app. python build_echo.py --render out.png
    if "--render" in sys.argv:
        target = sys.argv[sys.argv.index("--render") + 1]
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 32
        scene.render.resolution_x, scene.render.resolution_y = 600, 700
        bpy.ops.object.camera_add(location=(1.6, -4.2, 1.9))
        cam = bpy.context.active_object
        cam.data.lens = 50
        direction = Vector((0, 0, 1.05)) - cam.location
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
