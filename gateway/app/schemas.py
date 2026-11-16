from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app import config


class _Generation(BaseModel):
    model: str | None = None
    max_tokens: int | None = Field(default=None, ge=1)

    @field_validator("model")
    @classmethod
    def _model_allowed(cls, v):
        if v is not None and v not in config.ALLOWED_MODELS:
            raise ValueError(f"model must be one of {config.ALLOWED_MODELS}")
        return v

    def resolved(self) -> tuple[str, int]:
        model = self.model or config.LLM_MODEL
        max_tokens = min(self.max_tokens or config.DEFAULT_MAX_TOKENS, config.MAX_TOKENS_CAP)
        return model, max_tokens


class JobRequest(_Generation):
    prompt: str = Field(min_length=1, max_length=config.MAX_PROMPT_CHARS)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=config.MAX_PROMPT_CHARS)


class ChatCompletionRequest(_Generation):
    messages: list[ChatMessage] = Field(min_length=1, max_length=64)
    stream: bool = False


class CreateKey(BaseModel):
    name: str = Field(default="default", min_length=1, max_length=64)


class CreateTenant(BaseModel):
    name: str = Field(min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_\- ]*$")
    rate_limit_per_min: int = Field(default=60, ge=1, le=100_000)


class UpdateTenant(BaseModel):
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=100_000)
    is_active: bool | None = None
