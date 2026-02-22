"""Constants for the Restore Last Changed integration."""

DOMAIN = "restore_last_changed"

CONF_ENTITIES = "entities"

# Seconds to wait after HA started before querying recorder, so all
# entity platforms and the recorder's own startup tasks are done.
STARTUP_DELAY = 5
