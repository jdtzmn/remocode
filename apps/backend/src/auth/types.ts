export type AppAuthContext = {
  userId: string
  supabaseUserId: string
  claims: Record<string, unknown>
}

export type PluginAuthContext = {
  userId: string
  patId: string
  tokenPrefix: string
}

export type AuthBindings = {
  Variables: {
    appAuth: AppAuthContext
    pluginAuth: PluginAuthContext
  }
}
