# Sneup Usage Guide

## Quick Start

### 1. First-Time Setup

After installing Sneup (see README.md), follow these steps:

1. **Start the server**
   ```bash
   npm start
   ```

2. **Access the dashboard**
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

3. **Verify connection**
   The dashboard should show your Trello boards. If you see an error, check:
   - MongoDB is running
   - Trello API credentials are correct in `.env`
   - Server logs for any errors

### 2. Initial Synchronization

When Sneup starts, it automatically:
- Connects to your Trello account
- Syncs all accessible boards
- Creates database records for boards, lists, cards, and members
- Sets up webhooks for real-time updates (if configured)

This initial sync may take a few minutes depending on the number of boards.

## Core Features

### Automatic Synchronization

Sneup runs automated sync jobs:

**Full Sync** (Daily at 1 AM)
- Syncs all boards completely
- Updates all cards, lists, and members
- Recalculates all relationships

**Incremental Sync** (Every 15 minutes)
- Syncs recent changes only
- Faster than full sync
- Keeps data fresh

**Manual Sync**
```bash
# Via API
curl -X POST http://localhost:3000/api/boards/{boardId}/sync

# Via Dashboard
Click "Sync" button next to any board
```

### Analytics & Insights

**View Analytics**
```bash
# Get latest analytics for a board
curl http://localhost:3000/api/analytics/board/{boardId}/latest

# Get analytics history
curl http://localhost:3000/api/analytics/board/{boardId}/history?days=30
```

**Generate Analytics**
```bash
# Manually generate analytics
curl -X POST http://localhost:3000/api/analytics/board/{boardId}/generate
```

Analytics include:
- **Velocity**: Cards completed per day/week
- **Cycle Time**: Average time from start to finish
- **Bottlenecks**: Lists where cards get stuck
- **Project Health**: Overall health assessment
- **Team Performance**: Member utilization and productivity

### Bottleneck Detection

Sneup automatically detects bottlenecks by analyzing:
- Time cards spend in each list
- Card count in each list
- Historical patterns

**View Bottlenecks**
```bash
curl http://localhost:3000/api/analytics/board/{boardId}/bottlenecks
```

**Bottleneck Severity Levels:**
- **High**: Cards spend 3x longer than expected
- **Medium**: Cards spend 2x longer than expected

### Team Management

**Workload Analysis**
```bash
# Get team workload for a board
curl http://localhost:3000/api/team/board/{boardId}/workload
```

Shows:
- Each member's assigned card count
- Overdue cards per member
- High-risk cards per member
- Workload level (light, normal, heavy, overloaded)

**Auto-Assignment Suggestions**
```bash
# Get auto-assignment suggestions
curl http://localhost:3000/api/team/board/{boardId}/auto-assign
```

Sneup suggests assignments based on:
- Member workload
- Member specialties
- Card labels and content

**At-Risk Cards**
```bash
# Get at-risk cards
curl http://localhost:3000/api/team/board/{boardId}/at-risk
```

Identifies cards that are:
- Overdue
- Stuck in a list too long
- Have no assigned members
- Have no recent activity

**Team Report**
```bash
# Generate comprehensive team report
curl http://localhost:3000/api/team/board/{boardId}/report
```

Includes:
- Workload analysis
- At-risk cards
- Auto-assignment suggestions
- Recommendations

### Context & Relationships

**Card Context**
```bash
# Get context for a specific card
curl http://localhost:3000/api/boards/{boardId}/cards/{cardId}
```

Provides:
- Card details
- Related cards across boards
- Workflow position
- Team context
- Risk assessment
- NLP analysis

**Cross-Board Relationships**
```bash
# Get card relationships
curl http://localhost:3000/api/boards/{boardId}/relationships
```

Finds relationships based on:
- Shared team members
- Similar labels
- Similar names
- Common keywords

**Workflow Patterns**
```bash
# Get workflow patterns
curl http://localhost:3000/api/boards/{boardId}/workflow
```

Shows:
- Common list transitions
- Average cycle time
- Workflow stages

### NLP Analysis

Sneup uses Natural Language Processing to analyze:

**Sentiment Analysis**
- Analyzes sentiment in card descriptions and comments
- Classifies as: very negative, negative, neutral, positive, very positive
- Helps identify team morale and problem areas

**Keyword Extraction**
- Extracts important keywords using TF-IDF
- Identifies main topics and themes
- Helps categorize and relate cards

**Action Item Detection**
- Automatically detects action items in comments
- Identifies imperative verbs and action phrases
- Helps track follow-ups

**Entity Extraction**
- Extracts people mentions (@username)
- Identifies dates and deadlines
- Detects skills and roles mentioned

## API Usage Examples

### Get All Boards
```javascript
fetch('http://localhost:3000/api/boards')
  .then(res => res.json())
  .then(data => console.log(data.boards));
```

### Get Board with Details
```javascript
fetch('http://localhost:3000/api/boards/{boardId}')
  .then(res => res.json())
  .then(data => {
    console.log('Board:', data.board);
    console.log('Lists:', data.lists);
    console.log('Cards:', data.cards);
  });
```

### Get Analytics
```javascript
fetch('http://localhost:3000/api/analytics/board/{boardId}/latest')
  .then(res => res.json())
  .then(data => {
    console.log('Velocity:', data.analytics.velocity);
    console.log('Bottlenecks:', data.analytics.bottlenecks);
    console.log('Health:', data.analytics.projectHealth);
  });
```

### Execute Recommendation
```javascript
const recommendation = {
  type: 'reassign',
  cardId: 'card_id_here',
  cardName: 'Card Name',
  fromMember: { id: 'member1_id', username: 'user1' },
  toMember: { id: 'member2_id', username: 'user2' },
  reason: 'Workload balancing'
};

fetch('http://localhost:3000/api/team/recommendation/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ recommendation })
})
  .then(res => res.json())
  .then(data => console.log(data));
```

## Webhooks

Sneup can receive real-time updates from Trello via webhooks.

### Setup Webhooks

1. **Configure callback URL**
   Add to `.env`:
   ```env
   WEBHOOK_CALLBACK_URL=https://your-domain.com/api/webhooks/trello
   ```

2. **Restart Sneup**
   Webhooks are automatically registered on startup

3. **Verify webhooks**
   ```bash
   # Check registered webhooks via Trello API
   curl "https://api.trello.com/1/tokens/{YOUR_TOKEN}/webhooks?key={YOUR_KEY}"
   ```

### Webhook Events

Sneup processes these Trello events:
- Card created
- Card updated
- Card moved
- Card deleted
- Comment added
- Member assigned/removed
- Due date changed
- Label added/removed

## Monitoring & Logs

### View Logs

Logs are stored in the `logs/` directory:

```bash
# View combined logs
tail -f logs/combined.log

# View error logs only
tail -f logs/error.log

# View exceptions
tail -f logs/exceptions.log
```

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-31T12:00:00.000Z",
  "uptime": 3600
}
```

## Best Practices

### For Small Teams (1-10 boards)

- Use default sync intervals
- Enable webhooks for real-time updates
- Review team reports daily
- Act on at-risk cards immediately

### For Medium Teams (10-30 boards)

- Increase incremental sync frequency to every 10 minutes
- Set up automated alerts for critical boards
- Review analytics weekly
- Use auto-assignment suggestions

### For Large Teams (30+ boards)

- Use webhooks exclusively for real-time updates
- Reduce full sync frequency to weekly
- Implement custom analytics dashboards
- Integrate with Slack/email for notifications
- Use learning system to improve recommendations

## Troubleshooting

### Sync Issues

**Problem**: Boards not syncing
**Solution**:
1. Check Trello API credentials
2. Verify network connectivity
3. Check API rate limits
4. Review logs for errors

### Analytics Issues

**Problem**: No analytics generated
**Solution**:
1. Ensure boards have been synced
2. Check that boards have cards with history
3. Manually trigger analytics generation
4. Review logs for errors

### Performance Issues

**Problem**: Slow API responses
**Solution**:
1. Add database indexes (already included)
2. Reduce sync frequency
3. Increase server resources
4. Use pagination for large datasets

### Webhook Issues

**Problem**: Webhooks not working
**Solution**:
1. Verify callback URL is publicly accessible
2. Check webhook registration in Trello
3. Ensure HTTPS is used (Trello requirement)
4. Review webhook logs

## Advanced Usage

### Custom Sync Schedules

Edit `.env` to customize sync schedules:

```env
# Full sync every Sunday at 2 AM
FULL_SYNC_CRON=0 2 * * 0

# Incremental sync every 5 minutes
INCREMENTAL_SYNC_CRON=*/5 * * * *

# Analytics every 2 hours
ANALYTICS_CRON=0 */2 * * *
```

### Database Queries

Access MongoDB directly for custom queries:

```javascript
const mongoose = require('mongoose');
const Card = require('./src/models/Card');

// Find all overdue cards
const overdueCards = await Card.findOverdue();

// Find high-risk cards
const highRiskCards = await Card.findHighRisk();

// Custom query
const cards = await Card.find({
  closed: false,
  'labels.name': 'Bug',
  riskLevel: { $in: ['high', 'critical'] }
});
```

### Extending Sneup

Add custom services in `src/services/`:

```javascript
// src/services/customService.js
const logger = require('../utils/logger');

const customAnalysis = async () => {
  logger.info('Running custom analysis');
  // Your custom logic here
};

module.exports = { customAnalysis };
```

## Support

For issues, questions, or feature requests:
- GitHub Issues: https://github.com/Noodzakelijk-Online/sneup/issues
- Documentation: https://github.com/Noodzakelijk-Online/sneup
- Email: support@noodzakelijk.online

## Next Steps

1. Explore the dashboard at `http://localhost:3000`
2. Review your first team report
3. Act on at-risk cards
4. Set up webhooks for real-time updates
5. Customize sync schedules for your needs
6. Integrate with your existing tools

---

**Sneup** - Making project management autonomous and intelligent.
