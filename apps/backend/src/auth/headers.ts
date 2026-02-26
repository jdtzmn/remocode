export function readBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null
  }

  const [scheme, ...rest] = headerValue.trim().split(/\s+/)

  if (scheme?.toLowerCase() !== "bearer" || rest.length !== 1) {
    return null
  }

  const token = rest[0]
  return token.length > 0 ? token : null
}
