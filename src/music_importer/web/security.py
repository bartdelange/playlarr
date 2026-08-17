"""Single-user authentication and CSRF protection for the web application."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from urllib.parse import parse_qs, urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SESSION_COOKIE = "playlarr_session"
SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60
PUBLIC_PATHS = {"/health", "/login", "/setup"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
LOGIN_WINDOW_SECONDS = 5 * 60
LOGIN_ATTEMPTS = 5


class WebSecurity:
    def __init__(self, repository):
        self.repository = repository
        self.password_hasher = PasswordHasher()
        self.login_attempts: dict[str, deque[float]] = defaultdict(deque)

    @property
    def configured(self) -> bool:
        return bool(self.repository.get_setting("web_auth_password_hash"))

    def _secret(self) -> bytes:
        value = self.repository.get_setting("web_auth_session_secret")
        if not isinstance(value, str) or not value:
            value = secrets.token_urlsafe(48)
            self.repository.set_setting("web_auth_session_secret", value)
        return value.encode()

    def create_session(self) -> str:
        expires = str(int(time.time()) + SESSION_LIFETIME_SECONDS)
        nonce = secrets.token_urlsafe(24)
        payload = f"{expires}.{nonce}"
        signature = hmac.new(self._secret(), payload.encode(), hashlib.sha256).hexdigest()
        return f"{payload}.{signature}"

    def valid_session(self, token: str | None) -> bool:
        if not token:
            return False
        try:
            expires, nonce, signature = token.split(".", 2)
            payload = f"{expires}.{nonce}"
            expected = hmac.new(self._secret(), payload.encode(), hashlib.sha256).hexdigest()
            return int(expires) > time.time() and hmac.compare_digest(signature, expected)
        except (TypeError, ValueError):
            return False

    def csrf_token(self, session: str) -> str:
        return hmac.new(self._secret(), f"csrf.{session}".encode(), hashlib.sha256).hexdigest()

    def set_password(self, password: str) -> None:
        self.repository.set_setting("web_auth_password_hash", self.password_hasher.hash(password))

    def rotate_sessions(self) -> None:
        self.repository.set_setting("web_auth_session_secret", secrets.token_urlsafe(48))

    def verify_password(self, password: str) -> bool:
        encoded = self.repository.get_setting("web_auth_password_hash", "")
        if not isinstance(encoded, str):
            return False
        try:
            return self.password_hasher.verify(encoded, password)
        except (VerificationError, InvalidHashError):
            return False

    def allow_login(self, client: str) -> bool:
        now = time.monotonic()
        attempts = self.login_attempts[client]
        while attempts and attempts[0] <= now - LOGIN_WINDOW_SECONDS:
            attempts.popleft()
        return len(attempts) < LOGIN_ATTEMPTS

    def record_failed_login(self, client: str) -> None:
        self.login_attempts[client].append(time.monotonic())

    def clear_failed_logins(self, client: str) -> None:
        self.login_attempts.pop(client, None)


class SecurityMiddleware:
    """Authenticate requests and reject cross-site state changes before routing."""

    def __init__(self, app: ASGIApp, security: WebSecurity, enabled: bool = True):
        self.app = app
        self.security = security
        self.enabled = enabled

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        path = scope.get("path", "")
        public = path in PUBLIC_PATHS or path.startswith("/static/")

        if not self.security.configured and path not in {"/setup", "/health"}:
            await RedirectResponse("/setup", status_code=303)(scope, receive, send)
            return

        session = request.cookies.get(SESSION_COOKIE)
        authenticated = self.security.valid_session(session)
        if not public and not authenticated:
            await RedirectResponse("/login", status_code=303)(scope, receive, send)
            return

        if scope["method"] not in SAFE_METHODS:
            if not self._same_origin(request):
                await HTMLResponse("Cross-site request rejected", status_code=403)(
                    scope, receive, send
                )
                return
            if authenticated:
                body = await request.body()
                supplied = (
                    request.headers.get("x-csrf-token")
                    or parse_qs(body.decode(errors="replace")).get("csrf_token", [""])[0]
                )
                expected = self.security.csrf_token(session or "")
                if not hmac.compare_digest(supplied, expected):
                    await HTMLResponse("Invalid CSRF token", status_code=403)(scope, receive, send)
                    return
                receive = self._replay(body)

        scope.setdefault("state", {})["authenticated"] = authenticated
        scope["state"]["csrf_token"] = self.security.csrf_token(session) if authenticated else ""
        await self.app(scope, receive, send)

    @staticmethod
    def _same_origin(request: Request) -> bool:
        origin = request.headers.get("origin")
        if not origin:
            return True
        parsed = urlsplit(origin)
        return parsed.scheme in {"http", "https"} and parsed.netloc == request.headers.get("host")

    @staticmethod
    def _replay(body: bytes) -> Receive:
        sent = False

        async def receive() -> Message:
            nonlocal sent
            if sent:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        return receive


def register_security_routes(app: FastAPI, templates, security: WebSecurity) -> None:
    def page(request: Request, template: str, **values):
        return templates.TemplateResponse(request, template, values)

    @app.get("/setup", response_class=HTMLResponse)
    def setup_page(request: Request):
        if security.configured:
            return RedirectResponse("/login", status_code=303)
        return page(request, "setup.html")

    @app.post("/setup")
    def setup(password: str = Form(...), confirm_password: str = Form(...)):
        if security.configured:
            return RedirectResponse("/login", status_code=303)
        if len(password) < 12:
            return HTMLResponse("Password must be at least 12 characters", status_code=400)
        if password != confirm_password:
            return HTMLResponse("Passwords do not match", status_code=400)
        security.set_password(password)
        return _authenticated_redirect(security)

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request):
        if not security.configured:
            return RedirectResponse("/setup", status_code=303)
        return page(request, "login.html")

    @app.post("/login")
    def login(request: Request, password: str = Form(...)):
        client = request.client.host if request.client else "unknown"
        if not security.allow_login(client):
            return HTMLResponse("Too many login attempts; try again later", status_code=429)
        if not security.verify_password(password):
            security.record_failed_login(client)
            return page(request, "login.html", error="Invalid password")
        security.clear_failed_logins(client)
        return _authenticated_redirect(security)

    @app.post("/logout")
    def logout():
        response = RedirectResponse("/login", status_code=303)
        response.delete_cookie(SESSION_COOKIE)
        return response

    @app.post("/settings/password")
    def change_password(
        current_password: str = Form(...),
        password: str = Form(...),
        confirm_password: str = Form(...),
    ):
        if not security.verify_password(current_password):
            return HTMLResponse("Current password is incorrect", status_code=400)
        if len(password) < 12:
            return HTMLResponse("Password must be at least 12 characters", status_code=400)
        if password != confirm_password:
            return HTMLResponse("Passwords do not match", status_code=400)
        security.set_password(password)
        security.rotate_sessions()
        response = RedirectResponse("/login", status_code=303)
        response.delete_cookie(SESSION_COOKIE)
        return response


def _authenticated_redirect(security: WebSecurity) -> RedirectResponse:
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE,
        security.create_session(),
        max_age=SESSION_LIFETIME_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,
    )
    return response
