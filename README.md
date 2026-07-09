# Sneup - Autonomous AI-Powered Digital Project Manager for Trello

**Sneup** is an intelligent, autonomous project management system that manages 50+ Trello boards simultaneously with deep context understanding, bottleneck identification, task completion tracking, and autonomous team management.

## Features

### Autonomous Management
- **Automatic Synchronization**: Syncs all Trello boards with configurable intervals
- **Real-time Updates**: Webhook integration for instant change detection
- **Self-Learning System**: Learns from patterns and feedback to improve recommendations

### Deep Context Understanding
- **Cross-Board Intelligence**: Identifies relationships between cards across different boards
- **Workflow Pattern Recognition**: Analyzes and learns workflow patterns
- **Team Pattern Analysis**: Understands team member specialties and work styles

### Advanced Analytics
- **Bottleneck Detection**: Automatically identifies workflow bottlenecks with severity levels
- **Project Health Monitoring**: Continuous assessment of project health and risk factors
- **Velocity Tracking**: Measures team velocity and cycle time
- **Predictive Analytics**: Estimates completion dates and identifies risk areas

### Intelligent Team Management
- **Workload Balancing**: Analyzes team workload and suggests rebalancing
- **Smart Task Assignment**: Automatically assigns tasks based on member availability and specialties
- **At-Risk Card Detection**: Identifies cards at risk and suggests interventions
- **Team Performance Tracking**: Monitors individual and team performance metrics

### Natural Language Processing
- **Sentiment Analysis**: Analyzes sentiment in comments and communications
- **Keyword Extraction**: Identifies key topics and themes
- **Action Item Detection**: Automatically detects action items in comments
- **Communication Pattern Analysis**: Understands team communication styles

## Technology Stack

All components are battle-tested, production-ready open source libraries:

| Component | Library | Stars | Purpose |
|-----------|---------|-------|---------|
| Trello API | [trello.js](https://github.com/mrrefactoring/trello.js) | 20 | Modern TypeScript Trello client |
| NLP | [natural](https://github.com/NaturalNode/natural) | 10.9k | Text analysis, sentiment, keywords |
| Scheduling | [node-schedule](https://github.com/node-schedule/node-schedule) | 9.2k | Cron jobs for sync and analysis |
| Database | [mongoose](https://github.com/Automattic/mongoose) | 26k+ | MongoDB ODM for data persistence |
| Web Framework | [express](https://github.com/expressjs/express) | 65k+ | API and webhook endpoints |
| Logging | [winston](https://github.com/winstonjs/winston) | 23k+ | Production logging |

## Installation

### Prerequisites

- **Node.js** 14.0.0 or higher
- **MongoDB** 4.0 or higher
- **Trello Account** with API access

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Noodzakelijk-Online/sneup.git
   cd sneup
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your configuration:
   ```env
   # Trello API Credentials
   TRELLO_API_KEY=your_trello_api_key_here
   TRELLO_API_TOKEN=your_trello_api_token_here
   
   # MongoDB Configuration
   MONGODB_URI=mongodb://localhost:27017/sneup
   
   # Server Configuration
   PORT=3000
   NODE_ENV=development
   
   # Webhook Configuration (optional)
   WEBHOOK_CALLBACK_URL=https://your-domain.com/api/webhooks/trello
   ```

4. **Get Trello API credentials**
   - Visit [https://trello.com/app-key](https://trello.com/app-key)
   - Copy your API Key
   - Generate a Token by clicking the "Token" link
   - Add both to your `.env` file

5. **Start MongoDB**
   ```bash
   # Using Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   
   # Or use your local MongoDB installation
   mongod
   ```

6. **Start Sneup**
   ```bash
   npm start
   ```

   For development with auto-reload:
   ```bash
   npm run dev
   ```

## API Endpoints

### Boards

- `GET /api/boards` - Get all boards
- `GET /api/boards/:boardId` - Get specific board with lists and cards
- `POST /api/boards/:boardId/sync` - Manually sync a board
- `GET /api/boards/:boardId/context` - Get board context and relationships
- `GET /api/boards/:boardId/cards/:cardId` - Get card details with context and NLP analysis
- `GET /api/boards/:boardId/relationships` - Get card relationships
- `GET /api/boards/:boardId/workflow` - Get workflow patterns

### Analytics

- `GET /api/analytics/board/:boardId/latest` - Get latest analytics
- `GET /api/analytics/board/:boardId/history?days=30` - Get analytics history
- `POST /api/analytics/board/:boardId/generate` - Generate analytics
- `GET /api/analytics/critical` - Get critical boards
- `GET /api/analytics/board/:boardId/bottlenecks` - Get bottlenecks
- `GET /api/analytics/board/:boardId/health` - Get project health
- `GET /api/analytics/board/:boardId/velocity` - Get velocity metrics

### Team Management

- `GET /api/team/board/:boardId/workload` - Get workload analysis
- `GET /api/team/board/:boardId/auto-assign` - Get auto-assignment suggestions
- `GET /api/team/board/:boardId/at-risk` - Get at-risk cards
- `GET /api/team/board/:boardId/report` - Generate team report
- `POST /api/team/recommendation/execute` - Queue a workload recommendation for approval
- `GET /api/team/patterns` - Get team patterns

### Security and Workspace Context

- `GET /api/security/context` - Show the resolved actor, workspace, role, and permission context for the current request
- `GET /api/workspaces/current` - Show the current workspace and resolved workspace override capability
- `GET /api/workspaces` - List workspaces for identity administrators
- `POST /api/workspaces` - Create a workspace
- `POST /api/workspaces/:workspaceId/update` - Update workspace metadata, plan, status, or settings
- `GET /api/workspaces/:workspaceId/users` - List workspace users
- `POST /api/workspaces/:workspaceId/users` - Create a workspace user
- `POST /api/workspaces/:workspaceId/users/:userId/update` - Update a workspace user
- `GET /api/workspaces/:workspaceId/users/:userId/sessions` - List hashed user session records
- `POST /api/workspaces/:workspaceId/users/:userId/session` - Issue a one-time-visible user session token
- `POST /api/workspaces/:workspaceId/users/:userId/sessions/:sessionId/revoke` - Revoke a user session token

See `docs/MULTI_WORKSPACE_IDENTITY.md` for workspace selection, session token, and production migration notes.

### Connectors and Work Signals

- `GET /api/connectors` - List connector catalog entries and linked accounts
- `GET /api/connectors/accounts` - List linked connector accounts
- `POST /api/connectors/:connectorId/connect` - Begin an OAuth connector flow
- `POST /api/connectors/:connectorId/accounts` - Save an API-key, token, manual, basic, or webhook connector account
- `POST /api/connectors/accounts/:accountId/validate` - Mark a connector account as validated
- `DELETE /api/connectors/accounts/:accountId` - Remove a linked connector account
- `GET /api/work-signals/contracts` - List normalized sync adapter contracts for all connectors
- `GET /api/work-signals/adapters` - List implemented first-wave read-only provider adapters
- `GET /api/work-signals` - List normalized cross-tool work signals for the current workspace
- `GET /api/work-signals/graph` - Summarize normalized WorkItem/WorkActor/WorkContainer graph records, dependency types, freshness, review outcomes, and connector stale-edge quality
- `GET /api/work-signals/graph/decisions` - List graph-derived Robert/VA/team decision candidates
- `GET /api/work-signals/graph/items/:itemId` - Inspect a graph item with dependency edges, recent graph events, and queued recommendation history
- `POST /api/work-signals/graph/items/:itemId/queue` - Queue a graph item as an approval-gated recommendation
- `POST /api/work-signals/graph/dependencies/:dependencyId/review` - Confirm, refresh, or dismiss a stale dependency edge inside Sneup without provider writes
- `POST /api/work-signals/accounts/:accountId/upsert` - Upsert one normalized work signal from a linked connector account
- `POST /api/work-signals/accounts/:accountId/sync` - Run a read-only adapter sync for one connected account

### Operations Ledger and Approvals

- `GET /api/recommendations` - List approval-gated recommendations
- `GET /api/recommendations/:recommendationId` - Get a recommendation
- `GET /api/recommendations/:recommendationId/evidence` - Get source, decision, Trello action, follow-up, response, and audit evidence for a recommendation
- `POST /api/recommendations/:recommendationId/approve` - Approve a recommendation payload
- `POST /api/recommendations/:recommendationId/reject` - Reject a recommendation
- `POST /api/recommendations/:recommendationId/change` - Request changes to a recommendation
- `POST /api/recommendations/:recommendationId/execute-approved` - Execute an approved Trello action and record the attempt
- `GET /api/decision-queue/robert` - Robert-only high-risk decision queue
- `GET /api/decision-queue/team` - Team approval queue
- `GET /api/decision-queue/va` - VA queue scaffold
- `GET /api/autopilot/operations-brief` - Read-only daily operations brief across decisions, findings, follow-ups, failures, and board health
- `GET /api/trello-actions` - List Trello write attempts and failures
- `GET /api/audit` - List audit events
- `GET /api/follow-ups` - List follow-up plans
- `GET /api/follow-ups/due` - List due follow-up plans
- `GET /api/boards/:boardId/operations-ledger` - Board-level recommendation/action/audit ledger with Trello-linked and unresolved cross-provider graph context, source links, dependency freshness, and dependency filters
- `GET /api/boards/:boardId/operating-ledger` - Alias for board-level operating ledger
- `GET /api/boards/:boardId/decision-queue` - Board-specific decision queue
- `POST /api/boards/:boardId/analyze` - Safely analyze synced cards and persist findings/health snapshots
- `GET /api/boards/:boardId/findings` - Board-specific card findings
- `GET /api/boards/:boardId/health-snapshots` - Board health snapshot history
- `GET /api/cards/:cardId/operations-ledger` - Card-level recommendation/action/follow-up ledger with Trello-linked and unresolved cross-provider graph context, source links, dependency freshness, and dependency filters
- `GET /api/cards/:cardId/operating-ledger` - Alias for card-level operating ledger
- `GET /api/cards/:cardId/audit` - Card audit events
- `GET /api/cards/:cardId/findings` - Card findings and missing next-action/stale/blocked signals
- `GET /api/findings` - Global card finding list
- `GET /api/findings/board-health` - Global board health snapshot list
- `GET /api/jobs` - Job observability dashboard for sync, analytics, intervention, performance, and webhook jobs
- `GET /api/jobs/health` - Compact job health and stale-data summary
- `GET /api/jobs/runs` - Recent job run history with duration, counts, and failures
- `POST /api/jobs/:jobName/pause` - Pause a registered background job so scheduled runs are recorded as skipped
- `POST /api/jobs/:jobName/resume` - Resume a paused background job
- `POST /api/jobs/:jobName/trigger` - Manually trigger an allowlisted safe job
- `POST /api/interventions/:interventionId/record-response` - Record worker response to an intervention

### Webhooks

- `POST /api/webhooks/trello` - Trello webhook endpoint
- `HEAD /api/webhooks/trello` - Webhook verification

## Architecture

```
sneup/
|-- src/
|   |-- models/          # Mongoose data models
|   |   |-- Board.js
|   |   |-- List.js
|   |   |-- Card.js
|   |   |-- Member.js
|   |   |-- Comment.js
|   |   |-- Analytics.js
|   |   `-- Learning.js
|   |-- services/        # Business logic services
|   |   |-- trelloClient.js      # Trello API wrapper
|   |   |-- trelloSync.js        # Synchronization service
|   |   |-- nlpService.js        # NLP analysis
|   |   |-- contextAnalyzer.js   # Context intelligence
|   |   |-- analyticsService.js  # Analytics generation
|   |   `-- teamManager.js       # Team management
|   |-- routes/          # Express API routes
|   |   |-- boards.js
|   |   |-- analytics.js
|   |   |-- team.js
|   |   `-- webhooks.js
|   |-- utils/           # Utility functions
|   |   |-- logger.js
|   |   `-- database.js
|   `-- index.js         # Application entry point
|-- config/              # Configuration files
|-- logs/                # Application logs
|-- .env.example         # Environment template
|-- package.json
`-- README.md
```

## Scheduled Jobs

Sneup runs several automated jobs:

- **Full Sync**: Daily at 1 AM (configurable via `FULL_SYNC_CRON`)
- **Incremental Sync**: Every 15 minutes (configurable via `INCREMENTAL_SYNC_CRON`)
- **Analytics Generation**: Every hour (configurable via `ANALYTICS_CRON`)
- **Bottleneck Detection**: Every 30 minutes (configurable via `BOTTLENECK_DETECTION_CRON`)

## Data Models

### Board
Represents a Trello board with members, lists, and sync status.

### List
Represents a list within a board with position and card count.

### Card
Represents a card with full history, risk assessment, and relationships.

### Member
Represents a team member with workload level, specialties, and performance metrics.

### Comment
Represents a comment with sentiment analysis and action item detection.

### Analytics
Stores analytics snapshots including bottlenecks, velocity, and project health.

### Learning
Stores patterns, feedback, and recommendations for continuous improvement.

## Development

### Running Tests
```bash
npm test
```

### Linting
```bash
npm run lint
```

### Project Structure Guidelines
- **Models**: Define data schemas and business logic methods
- **Services**: Implement core business logic and external integrations
- **Routes**: Handle HTTP requests and responses
- **Utils**: Provide reusable utility functions

## Deployment

### Using Docker

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t sneup .
docker run -d -p 3000:3000 --env-file .env sneup
```

### Using PM2

```bash
npm install -g pm2
pm2 start src/index.js --name sneup
pm2 save
pm2 startup
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRELLO_API_KEY` | Trello API key | Required |
| `TRELLO_API_TOKEN` | Trello API token | Required |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/sneup` |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `WEBHOOK_CALLBACK_URL` | Webhook URL | Optional |
| `FULL_SYNC_CRON` | Full sync schedule | `0 1 * * *` |
| `INCREMENTAL_SYNC_CRON` | Incremental sync schedule | `*/15 * * * *` |
| `ANALYTICS_CRON` | Analytics schedule | `0 * * * *` |
| `LOG_LEVEL` | Logging level | `info` |

## Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB is running
- Check `MONGODB_URI` in `.env`
- Verify network connectivity

### Trello API Issues
- Verify API key and token are correct
- Check API rate limits
- Ensure proper permissions on boards

### Webhook Issues
- Verify `WEBHOOK_CALLBACK_URL` is publicly accessible
- Check webhook registration in Trello
- Review webhook logs

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Credits

Built with these amazing open source projects:

- **trello.js** by MrRefactoring
- **natural** by NaturalNode
- **node-schedule** by node-schedule team
- **mongoose** by Automattic
- **express** by Express team
- **winston** by Winston team

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

## Roadmap

- [ ] Dashboard UI with React
- [ ] Email notifications for critical events
- [ ] Slack integration
- [ ] Advanced machine learning for predictions
- [ ] Multi-language support
- [ ] Mobile app

---

**Sneup** - Making project management autonomous and intelligent.
