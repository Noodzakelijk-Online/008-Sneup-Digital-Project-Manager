# Sneup v2.0 - Autonomous AI Project Manager

**Sneup v2.0** is a revolutionary autonomous AI-powered digital project manager for Trello that doesn't just monitor—it **actively manages** your team, enforces accountability, and provides two-way conversational interaction with workers.

## 🚀 What's New in v2.0

### 1. Proactive Autonomous Management
Sneup now **takes action automatically** instead of just suggesting:

- **Auto-comments** on stuck cards with @mentions
- **Auto-reassigns** tasks based on workload balancing
- **Auto-escalates** to team leads when workers don't respond
- **Tracks accountability** - who responds, who ignores

**Example**: If a card is stuck for 4 days, Sneup automatically comments:
> "@john This card has been in 'In Progress' for 4 days. Expected completion was 2 days. Please provide status update by EOD."

If no response in 24 hours, Sneup follows up. If still no response in 48 hours, Sneup escalates to the team lead.

### 2. Performance Tracking & Accountability
Know exactly **who's pulling their weight** and who isn't:

- **Performance scores** (0-100) and grades (A-F) for every team member
- **Completion rate**, **on-time delivery rate**, **response rate**
- **Automatic flagging**: underperforming, overloaded, non-responsive
- **"Who's not pulling weight" reports** with evidence
- **Team rankings** and percentiles

**Example Report**:
```
John Smith - Performance Grade: D (Score: 58/100)
- Cards completed: 2 (team avg: 12)
- On-time delivery: 50% (team avg: 85%)
- Response rate: 30% (ignores 70% of follow-ups)
- Flags: underperforming, non_responsive
- Recommendation: Performance review required
```

### 3. Conversational AI Interface
Workers can now **talk to Sneup** to get clarity and help:

**Workers can ask:**
- "What should I work on right now?"
- "What are my priorities today?"
- "How am I performing?"
- "I'm stuck on card #123, what should I do?"
- "Can you reassign card #456? I'm overloaded."

**Sneup responds with:**
- Prioritized task lists
- Performance feedback
- Suggestions and next steps
- Automatic actions (reassignment, escalation, etc.)

**Example Conversation**:
```
Worker: "@sneup what should I work on now?"

Sneup: "Here are your priorities right now:

🔴 URGENT (Due in 2 hours)
• Card #123: Fix login bug - This is blocking 3 team members

🟡 HIGH PRIORITY (Due today)
• Card #456: Update API docs - Needed for client meeting tomorrow

You're currently assigned to 8 cards. Team average is 6. 
Let me know if you need help!"
```

### 4. Priority Engine
Real-time priority calculation based on:
- Risk level (critical, high, medium, low)
- Due date urgency
- Cards being blocked
- Time stuck in current list

Answers: **"What should I work on RIGHT NOW?"**

### 5. Escalation Workflows
Automatic escalation chain:
1. **Initial intervention** (card stuck, overdue, etc.)
2. **Follow-up after 24h** if no response
3. **Escalation to team lead after 48h** if still no response
4. **Performance flag** for repeated non-responsiveness

## 📊 Complete Feature List

### v1.0 Features (Still Included)
✅ Manage 50+ Trello boards simultaneously  
✅ Deep context understanding across boards  
✅ Bottleneck detection with severity levels  
✅ Task completion tracking with analytics  
✅ NLP analysis (sentiment, keywords, entities)  
✅ Cross-board relationship detection  
✅ Workflow pattern recognition  
✅ Team specialty identification  

### v2.0 New Features
✅ **Proactive interventions** (auto-comment, auto-reassign, auto-escalate)  
✅ **Performance tracking** (scores, grades, flags)  
✅ **Accountability enforcement** ("who's not pulling weight" reports)  
✅ **Conversational AI** (workers can ask questions and get help)  
✅ **Priority engine** ("what to work on right now")  
✅ **Escalation workflows** (24h follow-up, 48h escalation)  
✅ **Response tracking** (who responds, who ignores)  
✅ **Workload balancing** (automatic reassignment)  

## 🛠️ Technology Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Trello API | trello.js | Trello integration |
| NLP | natural | Text analysis |
| AI | OpenAI GPT-4 | Conversational AI |
| Scheduling | node-schedule | Automated jobs |
| Database | mongoose | MongoDB ODM |
| Web Framework | express | REST API |
| Logging | winston | Production logging |

## 📦 Installation

### Prerequisites
- Node.js 14.0.0+
- MongoDB 4.0+
- Trello account with API access
- OpenAI API key (for conversational AI)

### Setup

```bash
# Clone repository
git clone https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager.git
cd 008-Sneup-Digital-Project-Manager

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials:
# - TRELLO_API_KEY and TRELLO_API_TOKEN
# - MONGODB_URI
# - OPENAI_API_KEY (new in v2.0)

# Start MongoDB
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Start Sneup
npm start
```

### Access
- **Dashboard**: http://localhost:3000
- **API**: http://localhost:3000/api
- **Health Check**: http://localhost:3000/health

## 🎯 How It Works

### Autonomous Management Flow

```
1. Sneup detects issue (card stuck, member overloaded, etc.)
   ↓
2. Sneup takes action (comment, reassign, escalate)
   ↓
3. Sneup tracks response (did worker respond?)
   ↓
4. If no response → Follow-up after 24h
   ↓
5. If still no response → Escalate to team lead after 48h
   ↓
6. Sneup updates performance metrics
   ↓
7. Sneup learns from patterns for future decisions
```

### Worker Interaction Flow

```
1. Worker asks: "@sneup what should I work on?"
   ↓
2. Sneup analyzes: current cards, priorities, performance
   ↓
3. Sneup responds: prioritized list with context
   ↓
4. Worker takes action
   ↓
5. Sneup tracks: completion, time, quality
   ↓
6. Sneup updates: performance metrics, recommendations
```

## 🔧 API Endpoints

### v2.0 New Endpoints

#### Chat & Interaction
- `POST /api/chat/message` - Send message to Sneup
- `GET /api/chat/conversations/:memberId` - Get conversation history
- `GET /api/chat/priorities/:memberId` - Get prioritized cards
- `GET /api/chat/priorities/:memberId/immediate` - Get "what to work on now"
- `GET /api/chat/priorities/:memberId/daily` - Get daily priorities

#### Performance & Accountability
- `GET /api/performance/member/:memberId` - Get member performance
- `GET /api/performance/board/:boardId` - Get team performance
- `GET /api/performance/accountability/:boardId` - Get "who's not pulling weight" report
- `GET /api/performance/underperformers/:boardId` - Get underperformers
- `GET /api/performance/high-performers/:boardId` - Get high performers

#### Interventions
- `GET /api/interventions/pending` - Get pending interventions
- `GET /api/interventions/card/:cardId` - Get intervention history for card
- `GET /api/interventions/member/:memberId` - Get intervention history for member
- `POST /api/interventions/execute` - Manually trigger intervention

### v1.0 Endpoints (Still Available)
- All board, analytics, and team management endpoints from v1.0

## 💬 Worker Interaction Examples

### Example 1: Getting Priorities
```
Worker: "@sneup what should I work on right now?"

Sneup: "🔴 URGENT: Work on 'Fix login bug' (Card #123) immediately - 
it's blocking 3 team members and due in 2 hours."
```

### Example 2: Asking for Help
```
Worker: "@sneup I'm stuck on card #123"

Sneup: "I see you've been working on Card #123 for 4 hours. 
@sarah worked on similar issues last week. Want me to ask her for help? 
Or I can reassign this and give you Card #456 instead."
```

### Example 3: Performance Check
```
Worker: "@sneup how am I doing?"

Sneup: "📊 Overall Score: 85/100 (Grade: B)
✅ Cards Completed: 6 this week (team avg: 5)
✅ On-Time Delivery: 83%
You're performing well! Keep it up! 🚀"
```

### Example 4: Requesting Reassignment
```
Worker: "@sneup can you reassign card #789? I'm overloaded"

Sneup: "✅ I've reassigned Card #789 to @mike who has capacity.
Your updated priorities:
1. Card #123 (URGENT - due in 2h)
2. Card #456 (due today)
You now have 7 cards (down from 8). Let me know if you need more adjustments!"
```

## 📈 Performance Metrics

### Individual Metrics
- **Completion Rate**: Cards completed / cards assigned
- **On-Time Delivery Rate**: Cards completed on time / total completed
- **Response Rate**: Interventions responded to / total interventions
- **Average Cycle Time**: Average days from assignment to completion
- **Performance Score**: Weighted score (0-100)
- **Performance Grade**: A, B, C, D, or F

### Team Metrics
- Team averages for all individual metrics
- Member rankings and percentiles
- Underperformer identification
- High performer recognition

### Flags
- **underperforming**: Score < 60
- **overloaded**: Cards > 1.5x team average
- **non_responsive**: Response rate < 50%
- **consistently_late**: On-time rate < 70%
- **high_performer**: Score ≥ 90
- **needs_support**: Multiple escalations

## ⚙️ Configuration

### Intervention Settings
```env
INTERVENTION_CRON=*/30 * * * *  # Check every 30 minutes
FOLLOWUP_CRON=0 * * * *          # Follow-ups every hour
ESCALATION_CRON=0 */2 * * *      # Escalations every 2 hours
```

### Performance Tracking
```env
DAILY_PERFORMANCE_CRON=0 0 * * *    # Daily at midnight
WEEKLY_PERFORMANCE_CRON=0 1 * * 1   # Weekly on Monday 1 AM
MONTHLY_PERFORMANCE_CRON=0 2 1 * *  # Monthly on 1st at 2 AM
```

### OpenAI Configuration
```env
OPENAI_API_KEY=your_key_here
```

## 🎓 Best Practices

### For Managers
1. **Review accountability reports weekly** - Know who's underperforming
2. **Act on escalations immediately** - Sneup escalates for a reason
3. **Recognize high performers** - Sneup identifies top contributors
4. **Trust the automation** - Sneup learns and improves over time

### For Workers
1. **Respond to Sneup's comments** - Non-response hurts your metrics
2. **Ask Sneup for priorities daily** - Stay focused on what matters
3. **Use Sneup for help** - It can reassign, find resources, escalate
4. **Check your performance regularly** - Know where you stand

### For Teams
1. **Let Sneup balance workload** - It sees the full picture
2. **Use Sneup for transparency** - Everyone knows expectations
3. **Learn from patterns** - Sneup identifies what works
4. **Iterate on processes** - Sneup provides data for improvement

## 📊 Project Statistics

- **Total Lines of Code**: 7,613 lines (v2.0)
- **Files Created**: 40 files
- **New Models**: 3 (Intervention, Performance, Conversation)
- **New Services**: 4 (interventionEngine, performanceTracker, conversationalAI, priorityEngine)
- **New API Endpoints**: 15+ endpoints
- **New Workers**: 2 (interventionWorker, performanceWorker)

## 🔄 Migration from v1.0 to v2.0

v2.0 is **fully backward compatible** with v1.0. All v1.0 features still work.

**New requirements**:
1. Add `OPENAI_API_KEY` to `.env`
2. Run `npm install` to get OpenAI dependency
3. Restart Sneup

**No database migration needed** - new collections are created automatically.

## 🚨 Important Notes

### Autonomous Actions
Sneup v2.0 **takes real actions** on your Trello boards:
- Posts comments with @mentions
- Reassigns cards
- Adds labels
- Moves cards

**Test in a sandbox board first** before deploying to production!

### Performance Tracking
Performance metrics are **visible to managers** and can be used for:
- Performance reviews
- Identifying training needs
- Workload optimization
- Recognition and rewards

**Be transparent with your team** about what's being tracked.

### OpenAI Costs
Conversational AI uses OpenAI API which has costs:
- Estimated: $0.01-0.05 per conversation
- Budget accordingly for team size
- Monitor usage in OpenAI dashboard

## 📚 Documentation

- **README.md** - This file (v2.0 overview)
- **USAGE_GUIDE.md** - Detailed usage instructions (v1.0)
- **PROJECT_SUMMARY.md** - Technical specifications (v1.0)
- **SNEUP_V2_ARCHITECTURE.md** - v2.0 architecture details

## 🤝 Support

- **GitHub**: https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager
- **Issues**: https://github.com/Noodzakelijk-Online/008-Sneup-Digital-Project-Manager/issues

## 📄 License

MIT License - See LICENSE file

## 🎉 Conclusion

**Sneup v2.0** transforms project management from passive monitoring to **active autonomous management**. It doesn't just tell you what's wrong—it **fixes it**. It doesn't just track performance—it **enforces accountability**. It doesn't just assign tasks—it **helps workers succeed**.

**This is the future of project management.** 🚀

---

**Sneup v2.0** - Autonomous management. Enforced accountability. Conversational intelligence.
