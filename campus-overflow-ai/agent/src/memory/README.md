# Agent Memory

Memory access lives here.

The Agent service must read and write persistent memory through FastAPI internal
APIs. It must not own a separate database or write directly to MySQL.
