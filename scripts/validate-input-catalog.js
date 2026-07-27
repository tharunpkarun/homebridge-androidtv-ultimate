'use strict'

const { readFileSync } = require('node:fs')
const path = require('node:path')
const { validateInputCatalog } = require('../dist/input/input-catalog.js')

const file = path.join(__dirname, '..', 'catalog', 'input-presets.json')
const catalog = validateInputCatalog(JSON.parse(readFileSync(file, 'utf8')))
console.info(`Validated input catalog schema ${catalog.schemaVersion} with ${catalog.presets.length} presets.`)
