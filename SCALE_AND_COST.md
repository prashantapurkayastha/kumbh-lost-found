# Scale & Cost Analysis — Kumbh Lost & Found
**Event:** Kumbh Mela 2027, Prayagraj | **Duration:** ~45 days | **Attendance:** ~150M pilgrims

---

## 1. Event Scale Parameters

| Parameter | Value | Source |
|---|---|---|
| Total pilgrims (Maha Kumbh 2025 actual) | ~450M over 40 days | Govt. UP figures |
| Peak single-day attendance | ~60M (Mauni Amavasya) | Maha Kumbh 2025 |
| Daily average | ~10M | Estimate |
| Expected separation rate | 0.5–1.0% | Historical Kumbh data |
| **Daily lost/separated incidents** | **50,000–100,000** | Computed |
| Incidents resolved via digital system (10% adoption) | 5,000–10,000/day | Conservative |
| Peak hours | 6am–12pm, 4pm–8pm | Field observation |
| Help Desks | ~200 across ghats | Kumbh admin plan |
| Volunteers | ~1,000 active | Estimate |

---

## 2. User Request Breakdown (per incident)

Each "incident" triggers the following API calls:

| Step | Claude Calls | Tokens In | Tokens Out | Notes |
|---|---|---|---|---|
| Public chat (lost person describes situation) | 2–4 agentic turns | 2,000 | 800 | Tool calls for search/register |
| Photo Vision analysis (volunteer upload) | 1 | 1,500 (+ image) | 300 | claude-sonnet-4-6 vision |
| Registry search by volunteer | 1–2 | 1,200 | 500 | |
| Help desk match verification | 1 | 1,000 | 400 | |
| Handover + SMS | 0 Claude calls | — | — | Pure REST |
| **Total per incident** | **5–8 calls** | **~7,000** | **~2,500** | |

**Image cost:** Claude Sonnet 4.6 images are billed at ~1,600 tokens per image (1 megapixel). Average compressed photo ≈ 1,600 token equivalent.

---

## 3. Cost Model

### Claude API Pricing (Sonnet 4.6, as of June 2026)

| Metric | Price |
|---|---|
| Input tokens | $3.00 / 1M tokens |
| Output tokens | $15.00 / 1M tokens |
| Image input | ~$0.0048 per image |

### Per-Incident Cost

```
Input:  7,000 tokens × $3.00/M   = $0.021
Output: 2,500 tokens × $15.00/M  = $0.038
Image:  1 image × $0.0048        = $0.005
────────────────────────────────────────────
Total per incident:                ~$0.064
```

### Cost at Different Scale Tiers

| Daily Incidents | Daily Claude Cost | Monthly Cost (45 days) | Monthly + Infra |
|---|---|---|---|
| **1,000** (pilot, 1 district) | $64 | $2,880 | ~$3,400 |
| **5,000** (city deployment) | $320 | $14,400 | ~$16,500 |
| **10,000** (10% adoption) | $640 | $28,800 | ~$32,000 |
| **50,000** (50% adoption) | $3,200 | $144,000 | ~$160,000 |
| **100,000** (full scale) | $6,400 | $288,000 | ~$320,000 |

> **Key insight:** Even at 100% adoption of ALL incidents, Claude API cost is ~$320K for the entire 45-day festival — less than the cost of 50 additional police constables.

---

## 4. Infrastructure Cost

### Current Architecture (Single Server)

Suitable for **up to ~1,000 concurrent users** before degradation.

| Component | Cost/Month | Notes |
|---|---|---|
| App server (4 vCPU, 16 GB RAM) | $80–120 | AWS t3.xlarge or GCP n2-standard-4 |
| File storage (registry.json) | $0–5 | Sub-GB for registry data |
| SMS (Fast2SMS bulk) | $10–50 | ~₹0.12/SMS × 50,000 SMS |
| Domain + SSL | $10 | Let's Encrypt (free cert) |
| **Single-server total** | **~$120–185/month** | Not recommended for Kumbh scale |

### Scaled Architecture (Recommended for > 5,000 incidents/day)

```
                           ┌─────────────────────┐
                           │   Cloudflare CDN    │  (static assets, DDoS protection)
                           └──────────┬──────────┘
                                      │
                    ┌─────────────────┴──────────────────┐
                    │        Load Balancer                │
                    └──┬──────────────┬──────────────┬───┘
                       │              │              │
                  ┌────┴────┐   ┌─────┴───┐   ┌─────┴───┐
                  │ API-1   │   │ API-2   │   │ API-3   │  Express servers
                  └────┬────┘   └─────┬───┘   └─────┬───┘
                       └──────────────┴──────────────┘
                                      │
                          ┌───────────┴──────────┐
                          │   PostgreSQL + Redis  │  (replace file store)
                          └──────────────────────┘
```

| Component | Cost/Month | Notes |
|---|---|---|
| 3× app servers (2 vCPU, 8 GB) | $150 | Auto-scaling group |
| PostgreSQL (db.t3.medium) | $60 | Replace file-based store |
| Redis (cache.t3.micro) | $25 | Rate limiting + session store |
| Load balancer | $20 | AWS ALB |
| Cloudflare (free tier) | $0 | CDN + DDoS |
| S3 photo storage | $10–30 | ~100 GB of images |
| **Scaled total** | **~$265–285/month** | Handles 50K+ incidents/day |

### Full Production (All 200 help desks, peak Kumbh load)

| Component | Cost/Month |
|---|---|
| 10× API servers (auto-scale) | $500 |
| PostgreSQL (db.r6g.xlarge, Multi-AZ) | $400 |
| Redis cluster | $100 |
| S3 + CloudFront for photos | $80 |
| SMS (bulk package) | $500 |
| Monitoring (Datadog / Grafana) | $100 |
| **Total infra** | **~$1,680/month** |

---

## 5. Total Cost of Ownership (45 Days)

| Scale | Claude API | Infrastructure | SMS | **Total** | Per Incident |
|---|---|---|---|---|---|
| Pilot (1K/day) | $2,880 | $300 | $300 | **$3,480** | $0.077 |
| City (10K/day) | $28,800 | $600 | $2,000 | **$31,400** | $0.070 |
| Full (100K/day) | $288,000 | $2,500 | $15,000 | **$305,500** | $0.068 |

> **Economies of scale are strong:** cost per incident *falls* as volume rises because infra is nearly fixed.

---

## 6. Bottlenecks and Mitigation

### Bottleneck 1: Claude API Latency
- **Problem:** claude-sonnet-4-6 P95 response time is ~4–8 seconds. Under peak load (simultaneous requests from 1,000 volunteers), this feels slow.
- **Mitigations:**
  - Use `claude-haiku-4-5` for registry lookup calls (50ms faster, 80% cheaper). Switch only for complex reasoning.
  - Implement request queuing with progress indicators (already partially done via streaming)
  - Pre-warm agentic context with center-specific data at login time

### Bottleneck 2: File-backed store (registry.json)
- **Problem:** The current JSON file store has no concurrent write protection. At 100 simultaneous registrations, writes will collide.
- **Fix:** Migrate to PostgreSQL (or even SQLite with WAL mode) before going beyond 10 concurrent terminals.
- **Migration effort:** ~2 days (replace `store.ts` with `pg` adapter; schema already maps 1:1 to types)

### Bottleneck 3: Web Speech API at Scale
- **Problem:** Web Speech API has per-origin daily quota limits in Chrome (undocumented but ~1M characters/day).
- **Fix:** At scale, switch to Whisper API (`/v1/audio/transcriptions`) for volunteer voice input — $0.006/minute, handles noise better than browser ASR.

### Bottleneck 4: SMS Delivery
- **Problem:** Fast2SMS free tier is limited. Paid tier delivers ~1M SMS/day but requires batch processing.
- **Fix:** Move to AWS SNS (₹0.34/SMS to India numbers) with retry logic for failed deliveries.

---

## 7. Scaling Roadmap

| Phase | Timeline | Daily Incidents | Key Change |
|---|---|---|---|
| **0 — Demo** | Now | 10–100 | Current architecture |
| **1 — Pilot** | Month 1 | 500–1,000 | SQLite WAL, basic auth |
| **2 — District** | Month 2 | 5,000–10,000 | PostgreSQL, Redis, load balancer |
| **3 — Kumbh Ready** | Month 4 | 50,000–100,000 | Full production stack, 3-region HA |
| **4 — Post-Kumbh** | After event | Disaster response | Open-source + handoff to NDRF |

---

## 8. Cost Optimisation Opportunities

1. **Model routing:** Use `claude-haiku-4-5` ($0.80/$4.00 per M tokens) for simple searches; reserve Sonnet for complex multi-turn or vision. Estimated saving: **40–50% on API costs**.

2. **Caching registry searches:** Most searches are repeated (same age/gender/zone combos). Redis cache with 30s TTL reduces Claude calls by ~30%.

3. **Batch photo analysis:** Queue photos during off-peak and process in batches rather than inline. Reduces perceived latency and allows request coalescing.

4. **Prompt compression:** Current system prompt is ~800 tokens. Compressing to 400 tokens (removing redundancy) saves $0.001 per call — small but adds up to ~$10K at full Kumbh scale.

5. **Whisper for voice:** At full scale, browser ASR is free but unreliable. Whisper at $0.006/min × 2 min average = $0.012/voice interaction — often cheaper than a failed LLM call due to bad transcription.

---

*Analysis based on Maha Kumbh 2025 attendance data and Anthropic public pricing as of June 2026. Prices subject to change.*
