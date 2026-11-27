"""Deployment installation point for Otto extensions.

Import an extension module and call EXTENSIONS.register(extension) here. The
voice bridge consumes this registry; it does not know extension names or
implement a second tool router.
"""
from app.voice.extensions import ExtensionRegistry

EXTENSIONS = ExtensionRegistry()
