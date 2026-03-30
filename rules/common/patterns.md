# Common Patterns

## Skeleton Projects

When implementing new functionality:

1. Search for battle-tested skeleton projects
2. Use parallel agents to evaluate options:
   - Security assessment
   - Extensibility analysis
   - Relevance scoring
   - Implementation planning
3. Clone best match as foundation
4. Iterate within proven structure

## Design Patterns

### Repository Pattern

Encapsulate data access behind a consistent interface:

- Define standard operations: findAll, findById, create, update, delete
- Concrete implementations handle storage details (database, API, file, etc.)
- Business logic depends on the abstract interface, not the storage mechanism
- Enables easy swapping of data sources and simplifies testing with mocks

### API Response Format

Use a consistent envelope for all API responses:

- Include a success/status indicator
- Include the data payload (nullable on error)
- Include an error message field (nullable on success)
- Include metadata for paginated responses (total, page, limit)

## IPC Command/Event Patterns

For applications with a frontend-backend IPC boundary (e.g., Tauri, Electron):

### Commands (Request/Response)

- Use for synchronous-style operations where the frontend needs a result
- Define clear argument and return types on both sides of the boundary
- All types crossing the boundary must be serializable (JSON-compatible)

### Events (Push Notifications)

- Use for backend-initiated updates to the frontend
- Keep event payloads small and focused
- Clean up event listeners when components unmount

### Contract-First Design

- Define the IPC contract (command names, argument types, return types) before implementing either side
- Shared type definitions reduce drift between frontend and backend
