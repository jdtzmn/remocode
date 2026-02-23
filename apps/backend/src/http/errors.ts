import type { ApiError } from "@remocode/contracts"
import { ZodError } from "zod"

export type ApiErrorCode = ApiError["error"]["code"]
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 504

const defaultStatusByCode: Record<ApiErrorCode, ApiErrorStatus> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_PAYLOAD: 400,
  INVALID_EVENT_TYPE: 400,
  EVENT_DUPLICATE: 409,
  REQUEST_NOT_FOUND: 404,
  REQUEST_ALREADY_CLOSED: 409,
  PLUGIN_OFFLINE: 409,
  RELAY_TIMEOUT: 504,
  RELAY_EXECUTION_FAILED: 409,
  INVALID_QUESTION_ANSWERS: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

const defaultMessageByCode: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  INVALID_PAYLOAD: "Invalid payload",
  INVALID_EVENT_TYPE: "Invalid event type",
  EVENT_DUPLICATE: "Event already processed",
  REQUEST_NOT_FOUND: "Request not found",
  REQUEST_ALREADY_CLOSED: "Request already closed",
  PLUGIN_OFFLINE: "Target plugin is offline",
  RELAY_TIMEOUT: "Relay timeout",
  RELAY_EXECUTION_FAILED: "Relay execution failed",
  INVALID_QUESTION_ANSWERS: "Invalid question answers",
  RATE_LIMITED: "Rate limited",
  INTERNAL_ERROR: "Internal server error",
}

function formatZodIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }))
}

export class ApiHttpError extends Error {
  code: ApiErrorCode
  details: Record<string, unknown>
  status: ApiErrorStatus

  constructor(
    code: ApiErrorCode,
    options?: {
      message?: string
      details?: Record<string, unknown>
      status?: ApiErrorStatus
    },
  ) {
    super(options?.message ?? defaultMessageByCode[code])
    this.code = code
    this.details = options?.details ?? {}
    this.status = options?.status ?? defaultStatusByCode[code]
  }
}

export function toApiErrorResponse(
  code: ApiErrorCode,
  message = defaultMessageByCode[code],
  details: Record<string, unknown> = {},
): ApiError {
  return {
    error: {
      code,
      message,
      details,
    },
  }
}

export function toApiHttpError(error: unknown): ApiHttpError {
  if (error instanceof ApiHttpError) {
    return error
  }

  if (error instanceof ZodError) {
    return new ApiHttpError("INVALID_PAYLOAD", {
      details: {
        issues: formatZodIssues(error),
      },
    })
  }

  return new ApiHttpError("INTERNAL_ERROR")
}
