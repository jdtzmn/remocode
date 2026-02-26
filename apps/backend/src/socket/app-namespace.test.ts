import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Server } from "socket.io"
import { io as ioc } from "socket.io-client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ApiHttpError } from "../http/errors"
import { configureAppNamespace } from "./app-namespace"

const validToken = "valid-jwt-token"
const validUserId = "user-abc-123"

function createMockVerifyToken(options: { reject?: boolean } = {}) {
  return async (token: string) => {
    if (options.reject || token !== validToken) {
      throw new ApiHttpError("UNAUTHORIZED", { message: "Invalid access token" })
    }

    return {
      userId: validUserId,
      supabaseUserId: "supabase-user-1",
      claims: { sub: "supabase-user-1" },
    }
  }
}

function startTestServer(io: Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const httpServer = createServer()
    io.attach(httpServer)
    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address() as AddressInfo
      resolve({
        port,
        close: () =>
          new Promise((res) => {
            io.close(() => {
              httpServer.close(() => res())
            })
          }),
      })
    })
  })
}

describe("configureAppNamespace", () => {
  let io: Server
  let port: number
  let closeServer: () => Promise<void>

  beforeEach(async () => {
    io = new Server({ transports: ["websocket"] })
    configureAppNamespace(io, { verifyToken: createMockVerifyToken() })
    const server = await startTestServer(io)
    port = server.port
    closeServer = server.close
  })

  afterEach(async () => {
    await closeServer()
  })

  it("accepts connection with valid JWT and joins user:{userId} room", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/app`, {
        transports: ["websocket"],
        auth: { token: validToken },
      })

      socket.on("connect", () => {
        // Verify the socket joined the right room
        const appNs = io.of("/app")
        const socketId = socket.id as string
        const rooms = appNs.sockets.get(socketId)?.rooms

        expect(rooms?.has(`user:${validUserId}`)).toBe(true)

        socket.disconnect()
        resolve()
      })

      socket.on("connect_error", (err) => {
        socket.disconnect()
        reject(err)
      })
    })
  })

  it("rejects connection when token is missing", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/app`, {
        transports: ["websocket"],
        // no auth.token
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("UNAUTHORIZED")
        socket.disconnect()
        resolve()
      })
    })
  })

  it("rejects connection when token is invalid", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/app`, {
        transports: ["websocket"],
        auth: { token: "wrong-token" },
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("UNAUTHORIZED")
        socket.disconnect()
        resolve()
      })
    })
  })

  it("rejects connection when verifyToken throws", async () => {
    await closeServer()

    const failingIo = new Server({ transports: ["websocket"] })
    configureAppNamespace(failingIo, { verifyToken: createMockVerifyToken({ reject: true }) })
    const server = await startTestServer(failingIo)
    closeServer = server.close

    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${server.port}/app`, {
        transports: ["websocket"],
        auth: { token: validToken },
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("UNAUTHORIZED")
        socket.disconnect()
        resolve()
      })
    })
  })

  it("stores userId in socket.data", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/app`, {
        transports: ["websocket"],
        auth: { token: validToken },
      })

      socket.on("connect", () => {
        const appNs = io.of("/app")
        const socketId = socket.id as string
        const serverSocket = appNs.sockets.get(socketId)

        expect(serverSocket?.data.userId).toBe(validUserId)

        socket.disconnect()
        resolve()
      })

      socket.on("connect_error", (err) => {
        socket.disconnect()
        reject(err)
      })
    })
  })
})
