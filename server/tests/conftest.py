"""Keep the tests' continuity store out of the repository: `app.voice.bridge` opens it when it is imported."""
import os
import tempfile

os.environ.setdefault("CONTINUITY_STORE_PATH", os.path.join(tempfile.mkdtemp(prefix="otto-tests-"), "continuity.sqlite3"))
