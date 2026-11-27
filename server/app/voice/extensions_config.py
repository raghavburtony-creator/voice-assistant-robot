"""Explicit host-installed extension manifests (EXT-01).

Add imports for trusted, audited extension packages here. No dynamic discovery
or model-directed package loading is performed.
"""
from app.voice.extensions import ExtensionManager

# Deployments may add trusted ExtensionManifest instances here.
EXTENSION_MANAGER = ExtensionManager(())
