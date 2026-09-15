# BoB AI Ops: Predictive Port Operations Control Centre

## 👥 Team
| Field | Value |
| --- | --- |
| **Team Name** | AI Architects |
| **Track** | AI / Open |
| **Team Lead** | Aditya Amipara — [25dcs004@charusat.edu.in] |
| **Members** | Prit Tejani, Savan Sojitra, Jahnavi Suthar |

## 🎯 Problem Statement
Port supervisors struggle to optimally assign vessels to berths and cranes in real-time due to cascading delays, equipment faults, and unpredictable ETAs. This port congestion leads to massive supply chain delays, increased fuel emissions from idling ships, and skyrocketing demurrage costs. The lack of predictive visibility means operators react to conflicts after they happen rather than preventing them algorithmically.

## 💡 Solution
We built a Predictive Decision-Support System that simulates port states up to 72 hours in advance and proactively identifies scheduling conflicts. By leveraging a deterministic algorithmic optimization engine, the platform automatically recommends mathematically sound reassignments (e.g., swapping berths or shifting cranes) to resolve constraints, minimize wait times, and maximize port throughput before the bottlenecks actually occur.

## ✨ Key Features
- **Feature 1:** Real-Time Resource Conflict Engine — Instantly detects berth overlaps, crane shortfalls, and maintenance clashes.
- **Feature 2:** Deterministic Algorithmic Reassignment — One-click optimization to resolve conflicts with clear "Before vs. After" impact metrics.
- **Feature 3:** Predictive What-If Simulator — Safely test timeline manipulations (e.g., severe weather delays, crane breakdowns) without affecting the live operational state.
- **Feature 4:** Operations Copilot — A strategic briefing layer that synthesizes real-time metrics into actionable insights for the shift supervisor.
- **Feature 5:** 72-Hour Lookahead Planning — Visual timeline of all upcoming inbound, anchored, and moored vessels.

## 🛠️ Tech Stack
| Category | Technologies |
| --- | --- |
| **Languages** | TypeScript, HTML/CSS |
| **Frameworks** | React, Vite, Tailwind CSS |
| **State Management** | Zustand |
| **Other** | Lucide-React, Recharts |

## 📁 Repository Structure
\`\`\`text
├── src/                     # All source code 
├── docs/                    # Written documentation 
│   ├── problem-statement.md 
│   ├── solution-overview.md 
│   ├── architecture.md 
│   └── setup-guide.md 
├── demo/                    # Demo artifacts 
│   ├── screenshots/         # App screenshots 
│   └── demo-video-link.txt  # Link to demo video 
├── presentation/            # Slide deck 
└── submission.yaml          # Structured submission metadata
\`\`\`

## ⚡ How to Run
Copy these exact steps from your [docs/setup-guide.md](./docs/setup-guide.md)

\`\`\`bash
# 1. Clone the repo 
git clone https://github.com/PritTejani-1658/bob-ai-hackathon-Ai-Architect.git
cd bob-ai-hackathon-Ai-Architect

# 2. Install dependencies 
npm install

# 3. Run the project 
npm run dev
\`\`\`

## 🖥️ Demo
| Artifact | Link |
| --- | --- |
| 📹 **Demo Video** | [See demo/demo-video-link.txt](./demo/demo-video-link.txt) |
| 🌐 **Live Demo** | [See demo/live-demo-url.txt](./demo/live-demo-url.txt) |
| 🖼️ **Screenshots** | [See demo/screenshots/](./demo/screenshots) |
| 📊 **Presentation** | [See presentation/slides.pdf](./presentation/slides.pdf) |

## ⚠️ Known Limitations
- **Offline POC:** The application relies entirely on simulated synthetic mock data. Backend APIs are mocked via Zustand store to ensure 100% reliability during the presentation.
- **No Production LLM Integration:** The AI/algorithmic recommendations are purely deterministic mathematical engines written in TypeScript rather than external LLM calls to prevent hallucination in critical port operations.
- **Mocked Authentication:** Authentication and authorization layers are scaffolded/bypassed for demo purposes.

## 🏅 What We're Most Proud Of
We are incredibly proud of the **Algorithmic Reassignment & Optimization Engine**. Rather than simply flagging problems, the application mathematically evaluates capacity constraints, ETAs, and crane availability to propose deterministic solutions. Merging this backend logic seamlessly into a gorgeous, highly-responsive "dark mode" control center UI proves that complex port operations can be managed intuitively and efficiently.
