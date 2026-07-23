'use strict'

;(async () => {
  const { HomebridgePluginUiServer, RequestError } = await import('@homebridge/plugin-ui-utils')
  const api = require('../dist/ui-api.js')

  class AndroidTvUltimateUiServer extends HomebridgePluginUiServer {
    constructor() {
      super()
      this.onRequest('/discover', () => this.wrap(() => api.discover()))
      this.onRequest('/pair/start', payload => this.wrap(() => api.beginPairing(this.homebridgeStoragePath, payload.device)))
      this.onRequest('/pair/complete', payload => this.wrap(() => api.completePairing(payload.sessionId, payload.code)))
      this.onRequest('/pair/cancel', payload => this.wrap(async () => {
        api.cancelPairing(payload.sessionId)
        return { cancelled: true }
      }))
      this.onRequest('/status', () => this.wrap(() => api.status(this.homebridgeStoragePath)))
      this.onRequest('/test', payload => this.wrap(() => api.testConnection(this.homebridgeStoragePath, payload.device)))
      this.onRequest('/migration/preview', () => this.wrap(() => api.migrationPreview(this.homebridgeStoragePath)))
      this.onRequest('/migration/apply', () => this.wrap(() => api.applyMigration(this.homebridgeStoragePath)))
      this.onRequest('/diagnostics', () => this.wrap(() => api.diagnostics(this.homebridgeStoragePath)))
      this.ready()
    }

    async wrap(operation) {
      try {
        return await operation()
      } catch (error) {
        throw new RequestError('AndroidTV Ultimate', { message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  new AndroidTvUltimateUiServer()
})()
