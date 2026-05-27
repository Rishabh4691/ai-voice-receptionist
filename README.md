ai-voice-receptionist

A collaborative project built with Kanal Chandna. Started as a test — can an AI handle a real voice interaction end to end without a human touching anything? Still actively building on it.

AI-powered voice receptionist API — handles appointment booking, call session logging, and real-time voice interactions. Built with Groq LLM as the inference backend because it is significantly faster and free to use compared to OpenAI, which matters a lot when you are dealing with live voice where every millisecond of latency kills the experience.

What this actually is
Most AI projects stop at a chatbot in a browser. We wanted to push further.
The question we started with: can a system receive a voice call, understand what the person wants, book an appointment, log the session, and respond naturally — all without a human in the loop?
This is our ongoing attempt to answer that. It is not polished. It is not finished. But the core loop works — voice in, intent understood, appointment booked, session logged, response out.
Building this taught us more about how agentic systems actually make decisions than any course or tutorial. The interesting problems are not in the LLM call itself. They are in the orchestration around it — how do you handle ambiguous intent? What happens mid-conversation when the booking system throws an error? How do you keep the whole thing under 500ms end to end?

How it works
Incoming voice call
        ↓
Speech processed in real time
        ↓
Groq LLM — intent recognition + response generation
(chosen over OpenAI for speed + free tier — critical for live voice)
        ↓
Booking logic — checks availability, confirms slot, writes to DB
        ↓
Call session logged with full transcript
        ↓
Response returned to caller

Tech stack
LayerTechnologyRuntimeNode.js 20 (Alpine)FrameworkExpressLLM inferenceGroq API (Llama 3 / Mixtral)DatabaseSQLite via better-sqlite3ContainerisationDocker + Docker ComposeCI/CDGitHub ActionsReverse proxynginx (host-managed)InfrastructureSelf-hosted VPS with 3 environments

Why Groq and not OpenAI
Simple — Groq is free and fast. For a voice application where the user is waiting on the line, latency is everything. Groq's inference speed on Llama 3 and Mixtral is meaningfully faster than OpenAI's API in our testing, and the free tier let us iterate without worrying about cost while we were figuring out the architecture.

Environments
Three fully isolated environments running in parallel on the same VPS:
EnvironmentBranchPortStatusdevmain3040✅ Runningstagingstaging3041configuredprodprod3042configured
Each environment has its own Docker container, its own SQLite database volume, and its own secrets file on the VPS. Nothing bleeds between environments.
Promotion flow:
feature branch → main (auto-deploys dev)
                   ↓
               staging (manual merge, auto-deploys)
                   ↓
                prod (manual merge, auto-deploys)

API endpoints
MethodEndpointWhat it doesGET/api/healthLiveness checkGET/api/availability?date=YYYY-MM-DDAvailable slots for a dateGET/api/availability/summary14-day availability text for AI promptPOST/api/appointmentsBook an appointmentDELETE/api/appointments/:idCancel an appointmentPOST/api/calls/startStart a call sessionPOST/api/calls/endEnd a call session with transcriptGET/api/callsList all call sessionsPOST/api/chatGroq LLM proxy — API key never leaves the server

Running it locally
bash# Clone the repo
git clone https://github.com/Rishabh4691/ai-voice-receptionist.git
cd ai-voice-receptionist

# Add your environment variables
cp .env.example .env
# Set GROQ_API_KEY in .env

# Run with Docker
docker compose -f docker-compose.dev.yml up --build

# Or run directly
npm install
node server.js

Project structure
.
├── .github/workflows/
│   ├── deploy-dev.yml         # triggers on push to main
│   ├── deploy-staging.yml     # triggers on push to staging
│   └── deploy-prod.yml        # triggers on push to prod
├── scripts/
│   └── deploy.sh              # manual deploy helper
├── server.js                  # Express app, all routes, voice handling
├── db.js                      # SQLite schema, queries, seed data
├── docker-compose.dev.yml
├── docker-compose.staging.yml
├── docker-compose.prod.yml
├── Dockerfile
├── package.json
└── .env.example

What we are still working on
This is an active project. Things on the list:

Improve mid-conversation context handling — right now each turn is mostly stateless
Better intent disambiguation — the system sometimes misreads ambiguous requests
Proper error handling when the booking system is unavailable mid-call
Moving from SQLite to Postgres for the prod environment
Voice quality improvements — the current TTS response sounds robotic in some cases
Build a simple dashboard to visualise call logs and booking patterns


What building this taught us
The architecture of this project is not that different from a GTM automation system. You have a trigger (the call), a data layer (availability, appointments), an AI layer making decisions (Groq), an action layer executing them (booking), and a logging layer tracking everything (call sessions).
The same pattern shows up in outbound sales automation — prospect comes in, enrichment runs, AI qualifies and personalises, action is triggered, CRM is updated. The orchestration problem is identical. Building this from scratch gave us a real feel for where agentic systems break and how to design around those failure points.

Built with
Kanal Chandna — equal contributors across the full stack

Active project — commits ongoing.
