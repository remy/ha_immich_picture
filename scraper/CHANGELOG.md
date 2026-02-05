## 2.1.0

- **New**: Added built-in Home Assistant API client in `context.hass`
  - `getState(entityId)` - Get entity state and attributes
  - `setState(entityId, state, attributes)` - Set entity state
  - `getStates()` - Get all entity states
  - `callService(domain, service, serviceData)` - Call Home Assistant services
  - `getConfig()` - Get Home Assistant configuration

## 2.0.2

- **Fix** attempt to resolve `Error: Navigating frame was detached` [disabling `FedCm`](https://github.com/puppeteer/puppeteer/issues/14059)

## 2.0.1

- **Fix**: Correct auto-inserted function signature to use new context object format (`request`, `response`, `browser`, `cheerio`)
- Add cache busting with version query parameters on CSS and JS assets

## 2.0.0

**BREAKING CHANGE**: Updated handler function signature from `(req, res, browser)` to `(context)` object.

- **New context object**: Scripts now receive `{ request, response, browser, cheerio }` instead of separate parameters
- All user scripts must be updated to use the new context destructuring pattern
- Added example scripts demonstrating the new signature
- Updated documentation with migration guidance

## 1.3.3

- Add reload buttons
- Make navigation sticky
- Bake cheerio as a core dep

## 1.3.2

- Small fix that caused entire header to be clickable

## 1.3.1

- Fixed being able to read node modules
- Simplified UI for upload

## 1.3.0
- Added support for external node modules
- Improve UI in the editor

## 1.0.0
- Initial release.
