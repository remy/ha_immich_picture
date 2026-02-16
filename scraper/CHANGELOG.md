## 2.2.2

- Small improvement, show if a script is scheduled and when it's due

## 2.2.1

- **Fix** - variables being accessed before init 🤦

## 2.2.0

- **New**: Automatic cron-based script scheduling
  - Scripts can export `export const cron = "<expression>"` to run automatically
  - Cron format: `minute hour day month weekday` (e.g., `"0 */6 * * *"` for every 6 hours)
  - Scheduled runs receive `context.isScheduled: true` (no `request`/`response` objects)
  - All cron expressions validated at startup and logged
- **New**: Automatic schedule reloading with file watcher
  - Monitors script directory for changes (add, edit, delete, rename)
  - Debounces reloads with 60-second grace period to avoid excessive reloads during rapid edits
  - Gracefully stops old tasks and registers new schedules
- **New**: Execution queue for concurrent access control
  - Prevents Puppeteer conflicts by limiting to one script execution at a time
  - Multiple requests automatically queued (FIFO) with position and wait time logging
  - Both scheduled and manual API calls use the same queue
- **New**: Graceful shutdown handling
  - Proper cleanup of cron tasks, file watcher, execution queue on process termination (SIGTERM/SIGINT)
  - Handles uncaught exceptions with full resource cleanup
  - All shutdown events logged with `[SCHEDULER]` prefix
- **Improved**: File existence validation before scheduled script execution
- **Improved**: Concurrent reload protection to prevent multiple simultaneous reloads
- **Improved**: Comprehensive logging for queue, scheduler, and shutdown events with `[QUEUE]` and `[SCHEDULER]` prefixes

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
