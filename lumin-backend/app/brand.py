"""The platform's name, read from the APP_NAME variable (empty = "Lumin"). Used in emails, push titles,
messages the API returns, and the authenticator-app label. The website has its own NEXT_PUBLIC_APP_NAME."""
import html as _html
import os

APP_NAME = (os.environ.get("APP_NAME") or "").strip() or "Lumin"
APP_NAME_HTML = _html.escape(APP_NAME)
