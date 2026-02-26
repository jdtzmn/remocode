import { describe, expect, it, vi } from "vitest"
import { type OpenCodeClient, registerCommandHandlers } from "./command-handler"
import type { PluginSocketType } from "./socket-client"
import type { PluginAckEnvelope, PluginCommandEnvelope } from "./socket-client"

type EventHandler = (...args: unknown[]) => void

function makeSocket() {
  const handlers: Record<string, EventHandler> = {}

  const socket = {
    on: (event: string, handler: EventHandler) => {
      handlers[event] = handler
    },
  } as unknown as PluginSocketType

  const emit = (event: string, ...args: unknown[]) => handlers[event]?.(...args)

  return { socket, emit }
}

function makeClient(options: { shouldThrow?: boolean } = {}): OpenCodeClient {
  return {
    postSessionIdPermissionsPermissionId: vi.fn(async () => {
      if (options.shouldThrow) {
        throw new Error("permission denied")
      }
    }),
  }
}

describe("registerCommandHandlers", () => {
  const serverUrl = new URL("http://127.0.0.1:4096")

  describe("action.permission.reply", () => {
    it("calls postSessionIdPermissionsPermissionId and acks accepted=true on success", async () => {
      const { socket, emit } = makeSocket()
      const client = makeClient()

      registerCommandHandlers({ client, serverUrl, socket })

      const ack = vi.fn()
      const envelope: PluginCommandEnvelope<{
        reply: "once" | "always" | "reject"
        message?: string
      }> = {
        command_id: "cmd-1",
        request_id: "perm-request-1",
        session_id: "session-abc",
        payload: { reply: "once" },
      }

      await emit("action.permission.reply", envelope, ack)

      expect(client.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
        body: { response: "once" },
        path: { id: "session-abc", permissionID: "perm-request-1" },
      })

      const ackCall = ack.mock.calls[0][0] as PluginAckEnvelope
      expect(ackCall.command_id).toBe("cmd-1")
      expect(ackCall.accepted).toBe(true)
      expect(ackCall.error).toBeNull()
    })

    it("acks accepted=false when permission call throws", async () => {
      const { socket, emit } = makeSocket()
      const client = makeClient({ shouldThrow: true })

      registerCommandHandlers({ client, serverUrl, socket })

      const ack = vi.fn()
      const envelope: PluginCommandEnvelope<{ reply: "once" | "always" | "reject" }> = {
        command_id: "cmd-2",
        request_id: "perm-2",
        session_id: "session-abc",
        payload: { reply: "always" },
      }

      await emit("action.permission.reply", envelope, ack)

      const ackCall = ack.mock.calls[0][0] as PluginAckEnvelope
      expect(ackCall.accepted).toBe(false)
      expect(ackCall.error).toContain("permission denied")
    })

    it("relays the 'reject' decision correctly", async () => {
      const { socket, emit } = makeSocket()
      const client = makeClient()

      registerCommandHandlers({ client, serverUrl, socket })

      const ack = vi.fn()
      const envelope: PluginCommandEnvelope<{ reply: "once" | "always" | "reject" }> = {
        command_id: "cmd-3",
        request_id: "perm-3",
        session_id: "session-xyz",
        payload: { reply: "reject" },
      }

      await emit("action.permission.reply", envelope, ack)

      expect(client.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
        body: { response: "reject" },
        path: { id: "session-xyz", permissionID: "perm-3" },
      })

      const ackCall = ack.mock.calls[0][0] as PluginAckEnvelope
      expect(ackCall.accepted).toBe(true)
    })
  })

  describe("action.question.reply", () => {
    it("POSTs to /question/:requestID/reply and acks accepted=true", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
      vi.stubGlobal("fetch", mockFetch)

      const { socket, emit } = makeSocket()
      const client = makeClient()

      registerCommandHandlers({ client, serverUrl, socket })

      const ack = vi.fn()
      const envelope: PluginCommandEnvelope<{ answers: string[][] }> = {
        command_id: "cmd-4",
        request_id: "question-1",
        session_id: "session-abc",
        payload: { answers: [["Unit"]] },
      }

      await emit("action.question.reply", envelope, ack)

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain("/question/question-1/reply")
      expect(JSON.parse(init.body as string)).toMatchObject({ answers: [["Unit"]] })

      const ackCall = ack.mock.calls[0][0] as PluginAckEnvelope
      expect(ackCall.accepted).toBe(true)

      vi.unstubAllGlobals()
    })

    it("acks accepted=false when question reply HTTP call fails", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response("Bad Request", { status: 400 }))
      vi.stubGlobal("fetch", mockFetch)

      const { socket, emit } = makeSocket()
      const client = makeClient()

      registerCommandHandlers({ client, serverUrl, socket })

      const ack = vi.fn()
      const envelope: PluginCommandEnvelope<{ answers: string[][] }> = {
        command_id: "cmd-5",
        request_id: "question-2",
        session_id: "session-abc",
        payload: { answers: [["All"]] },
      }

      await emit("action.question.reply", envelope, ack)

      const ackCall = ack.mock.calls[0][0] as PluginAckEnvelope
      expect(ackCall.accepted).toBe(false)
      expect(ackCall.error).toContain("400")

      vi.unstubAllGlobals()
    })
  })

  describe("action.question.reject", () => {
    it("POSTs to /question/:requestID/reject and acks accepted=true", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
      vi.stubGlobal("fetch", mockFetch)

      const { socket, emit } = makeSocket()
      const client = makeClient()

      registerCommandHandlers({ client, serverUrl, socket })

      const ack = vi.fn()
      const envelope: PluginCommandEnvelope = {
        command_id: "cmd-6",
        request_id: "question-3",
        session_id: "session-abc",
        payload: {},
      }

      await emit("action.question.reject", envelope, ack)

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain("/question/question-3/reject")

      const ackCall = ack.mock.calls[0][0] as PluginAckEnvelope
      expect(ackCall.accepted).toBe(true)

      vi.unstubAllGlobals()
    })

    it("acks accepted=false when question reject HTTP call fails", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }))
      vi.stubGlobal("fetch", mockFetch)

      const { socket, emit } = makeSocket()
      const client = makeClient()

      registerCommandHandlers({ client, serverUrl, socket })

      const ack = vi.fn()
      const envelope: PluginCommandEnvelope = {
        command_id: "cmd-7",
        request_id: "question-4",
        session_id: "session-abc",
        payload: {},
      }

      await emit("action.question.reject", envelope, ack)

      const ackCall = ack.mock.calls[0][0] as PluginAckEnvelope
      expect(ackCall.accepted).toBe(false)
      expect(ackCall.error).toContain("404")

      vi.unstubAllGlobals()
    })
  })
})
