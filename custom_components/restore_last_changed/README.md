# Restore Last Changed

A Home Assistant custom integration that restores accurate `last_changed` and `last_updated` timestamps for specified entities after a restart, by querying the recorder database on startup.

Without this integration, every entity shows its `last_changed` as the time HA last restarted, rather than when its state actually changed. This integration fixes that for whichever entities you list.

## Installation

Copy the `restore_last_changed` folder into your `custom_components` directory:

```
config/
└── custom_components/
    └── restore_last_changed/
        ├── __init__.py
        ├── const.py
        ├── manifest.json
        ├── schema.py
        └── README.md
```

## Configuration

Add the following to your `configuration.yaml`:

```yaml
restore_last_changed:
  entities:
    - sensor.my_sensor
    - binary_sensor.front_door
    - input_boolean.guest_mode
```

Restart Home Assistant after saving the file.

### Options

| Key | Required | Description |
|---|---|---|
| `entities` | Yes | List of entity IDs whose `last_changed`/`last_updated` should be restored from the recorder database on startup. |

## How it works

1. On startup, the integration registers a listener for the `homeassistant_started` event.
2. Once HA is fully started, it waits 5 seconds to ensure entity platforms and the recorder have finished loading.
3. For each configured entity, it queries the recorder for the most recent state change recorded before the restart.
4. If a historical state is found, it re-applies it to the state machine with the original `last_changed` and `last_updated` timestamps.

## Requirements

- Home Assistant with the **Recorder** integration enabled (it is on by default).
- Entities must have history in the recorder database — if an entity has never had a state recorded, it will be skipped.

## Logging

Check your HA logs for messages from `custom_components.restore_last_changed`:

| Level | Meaning |
|---|---|
| `info` | Timestamp successfully restored for an entity. |
| `debug` | Entity skipped (not in state machine, or no history found). |
| `warning` | Recorder was not available at startup time. |

To enable debug logging, add this to `configuration.yaml`:

```yaml
logger:
  default: warning
  logs:
    custom_components.restore_last_changed: debug
```

## Troubleshooting

**Entity still shows restart time as `last_changed`**
- Confirm the entity ID is spelled correctly (check *Developer Tools → States*).
- Check that the recorder has history for the entity before the restart.
- Look for warning or error messages in the HA logs.

**Warning: "Recorder instance not available"**
- The recorder integration may not be loaded. Ensure `recorder:` is present in your `configuration.yaml` (or that it hasn't been explicitly disabled).
