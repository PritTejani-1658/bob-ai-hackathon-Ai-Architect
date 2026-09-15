# Architecture

Our architecture is optimized for a fast, responsive, edge-ready application using modern web technologies. For this POC, all complex scheduling algorithms run entirely in-browser, showcasing the speed and deterministic power of the engines.

## Folder Structure (Web App Pattern)
- \`src/frontend/\`: Contains all UI code (React Components, Tailwind Styling, Routing).
- \`src/shared/\`: Contains all shared types, mock data, Zustand state stores, and the core operational engines (Congestion Engine, Optimization Engine, Copilot Engine).
- \`src/backend/\`: Stubbed for this POC. In production, the shared logic would shift to Python/FastAPI microservices and IBM watsonx.

## Core Engines
1. **Zustand Global Store (\`src/shared/store.ts\`)**: Maintains the single source of truth for Vessels, Berths, Cranes, and Simulator overrides.
2. **Resource Conflict Engine (\`src/shared/services/resourceConflictEngine.ts\`)**: Continuously monitors the store for overlaps, returning a standard array of alerts.
3. **Optimization Engine (\`src/shared/services/optimizationEngine.ts\`)**: A multi-pass scoring algorithm that evaluates unassigned and conflicted vessels and matches them to alternative berths/cranes, factoring in vessel dimensions, priority, and ETAs.

## UI Layer
Built with React, Vite, and Tailwind CSS to ensure a dark-mode, high-contrast visual hierarchy typical of industrial control centers. Components are highly modular and subscribe strictly to localized slices of the Zustand state to maintain 60fps performance during heavy UI updates.
