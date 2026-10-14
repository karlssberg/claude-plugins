# Behaviour visualisation for code review: prior art and research

Research for a planned Claude Code plugin that produces diagram-first, drill-down explanations of behaviours in a codebase. Its main use is making pull-request changes visible. It can also run on a whole codebase, where it defaults to load-bearing and hot paths.

- Compiled: 2026-10-13
- Method: web search and fetches of primary sources where reachable (official docs, READMEs, papers and abstracts, author posts, Hacker News threads via the Algolia API). Every claim carries a URL. Claims labelled **(unverified)** come from secondary sources only, or the sources disagree.
- Quotes are kept under 15 words. HN commenters are named by username and comment id.

---

## TL;DR: takeaways that should shape the design

1. **Understanding the change is the main problem in review, and diff views don't solve it.** Microsoft's study found "code and change understanding is the key aspect of code reviewing", and that most of the ways developers get that understanding "are not met by current tools" ([Bacchelli & Bird, ICSE 2013](https://microsoft.com/en-us/research/?p=164195)). That is the gap the plugin targets.
2. **Split a PR into behaviours before drawing anything.** More than 40% of Microsoft review changesets could be split into independent parts. Developers judged automatic partitions correct in 16 of 20 cases ([Barnett et al., ICSE 2015, via Acolyer](https://blog.acolyer.org/2015/06/26/helping-developers-help-themselves-automatic-decomposition-of-code-review-changes/)). Splitting cut reviewers' false alarms ([Di Biase et al., controlled experiment](https://arxiv.org/abs/1805.10978)). The unit of explanation should be "one behaviour", not "one file".
3. **Diagrams generated straight from code are accurate but too detailed to use.** This is the model-code gap ([IcePanel on Fairbanks](https://icepanel.io/blog/the-model-code-gap); [Simon Brown's slides](https://s3.amazonaws.com/static.codingthearchitecture.com/presentations/sclondon2018-model-code-gap.pdf)). C4 says code-level diagrams are optional and only worth drawing for the most important or complex components ([c4model.com/diagrams/code](https://c4model.com/diagrams/code)). Developers repeat this: "I've never found auto-generated diagrams helpful yet" ([HN alixanderwang 41394000](https://hn.algolia.com/api/v1/items/41393458)). The value is in choosing the abstraction, not in drawing every edge.
4. **Hallucinated diagrams lose trust fast.** DeepWiki users report diagrams that were "too handwavy" or simply wrong, and wikis that hallucinate "pretty convincingly" ([HN thread 45002092](https://hn.algolia.com/api/v1/items/45002092)). In 23,247 agent-written PRs, PRs whose description didn't match the code were accepted 28.3% of the time against 80.0% for the rest ([arXiv 2601.04886](https://arxiv.org/abs/2601.04886)). **Every node and edge must point to evidence at file:line, and anything without evidence should be left out (fail closed).** Archify ([guide](https://betterstack.com/community/guides/ai/archify-architecture.md)) and CodeBoarding ([README](https://github.com/CodeBoarding/CodeBoarding)) both work this way: deterministic extraction or validation first, with the LLM limited to naming and grouping.
5. **Choose the starting level of abstraction from the context, and keep each diagram to one question.** C4 dynamic diagrams cover "a single feature, story, or use case" and are meant to be used sparingly ([c4model.com/diagrams/dynamic](https://c4model.com/diagrams/dynamic)). Archify's rule is "one question per diagram", with 8–12 nodes ([guide](https://betterstack.com/community/guides/ai/archify-architecture.md)). A community Claude Code skill caps diagrams at 15–20 nodes ([cartograph listing](https://openskillindex.com/skills/athola-claude-night-market-architecture-diagram)).
6. **Standalone visualisation products struggle; tools inside the existing workflow survive.** CodeSee shut down commercial operations, citing uneven revenue and the cost of covering "more IDEs, more tech stacks, more programming languages" ([CodeSee shutdown post, LinkedIn, unverified author](https://sk.linkedin.com/in/daniel-ivanyi-16845458)). Sourcetrail was discontinued in 2021 after a Patreon model failed. HN commenters said call-graph tools are needed "only once" and compete with the IDE ([HN 28637193](https://hn.algolia.com/api/v1/items/28637193)). A Claude Code plugin sits inside the agent the developer already uses and can borrow LSP and LLM capability instead of maintaining its own indexers. That matches the main structural reason earlier tools died.
7. **Runtime traces show what really happens but cost a lot to set up.** AppMap records runtime traces from tests and shows sequence diagrams, including a sequence-diagram diff between two recordings ([AppMap docs](https://appmap.io/docs/reference/guides/using-appmap-diagrams.html)). It needs language agents, and the product has since shifted toward its AI assistant, Navie ([AppMap docs home](https://appmap.io/docs/appmap-docs.html)). Use static analysis plus LLM by default, and import traces (AppMap or OpenTelemetry) when they exist.
8. **Rank critical paths from several signals, not one.** Combine churn × complexity hotspots ([CodeScene docs](https://codescene.io/docs/guides/technical/hotspots.html); [Tornhill & Borg, Code Red](https://arxiv.org/abs/2203.04374)), PageRank or centrality over dependency graphs ([key-class research](https://www.scitepress.org/Papers/2015/54659/54659.pdf)) and entry points.
9. **Treat seams and error paths as the main content, not footnotes.** Feathers defines a seam as a place to alter behaviour without editing there, with an "enabling point" ([LeadDev quoting WELC](https://leaddev.com/technical-direction/how-refactor-legacy-systems-creating-application-seams)). Reachability questions, such as "can this call lead to that effect?", are among the hardest for developers to answer: 82% rated them hard ([LaToza & Myers, PLATEAU 2010 slides](https://ecs.wgtn.ac.nz/foswiki/pub/Events/PLATEAU/2010Program/plateau10-latoza-slides.pdf)). Mermaid sequence diagrams have `alt`, `opt`, `critical` and `break` blocks for error paths ([Mermaid docs](https://mermaid.js.org/syntax/sequenceDiagram.html)).
10. **Plan rendering around how hosts limit Mermaid.** Click handlers need `securityLevel: 'loose'` ([Mermaid flowchart docs](https://mermaid.js.org/syntax/flowchart.html)). GitHub's Mermaid rendering does not reliably support hyperlinks, tooltips or callbacks ([gist](https://gist.github.com/LucasArruda/8fd558990bbc187f1a5787ee3d16b301)). Defaults cap a diagram at 50,000 characters and 500 edges ([Mermaid config](https://mermaid.js.org/config/schema-docs/config.html)). Interactive drill-down therefore needs a host the plugin controls, such as a self-contained HTML page or artifact. PR comments should get static Mermaid with plain Markdown links next to it.

---

## 1. Prior art

### 1.1 Summary table

| Tool | Approach | Outcome / status | Lessons for us |
|---|---|---|---|
| **CodeSee** (Maps, Review Maps) | Static dependency maps of files; automatic **Review Maps** on each PR showing changed files, their dependencies and clusters ([docs](https://docs.codesee.io/docs/review-maps-for-visual-studio-code); [learn.codesee.io](https://learn.codesee.io/introducing-the-codesee-review-maps-extension)) | Acquired by GitKraken in May 2024 ([HN 40361461](https://hn.algolia.com/api/v1/search?query=codesee&tags=story); [schneider.im](https://www.schneider.im/gitkraken-acquired-codesee)). Shutdown post cites inconsistent sales and the cost of covering many languages and IDEs ([LinkedIn, unverified](https://sk.linkedin.com/in/daniel-ivanyi-16845458)) | File-level maps for PRs were the closest prior art and did not support a standalone business. Language coverage was a cost driver. |
| **Sourcetrail** | Static indexer (Clang/Java/Python) with an interactive graph plus code view | Open-sourced in 2019, discontinued in 2021 ([Wikipedia](https://en.wikipedia.org/wiki/Sourcetrail)). HN: used too rarely to sell, competes with the IDE ([HN 28637193](https://hn.algolia.com/api/v1/items/28637193)) | Keeping per-language indexers alive is expensive. Showing "one level of dependencies" kept graphs readable ([HN 14612440](https://hn.algolia.com/api/v1/items/14612440)). |
| **AppMap** | **Runtime** traces from agents during tests or requests; sequence diagrams, sequence-diagram diffs, PlantUML export ([docs](https://appmap.io/docs/reference/guides/using-appmap-diagrams.html)) | 90k+ claimed users; now AI-first (Navie) ([docs](https://appmap.io/docs/appmap-docs.html)). Low HN traction ([HN search](https://hn.algolia.com/api/v1/search?query=appmap&tags=story)) | Runtime shows real behaviour, including N+1 queries. Hiding lifelines, collapsing calls and depth limits are needed to tame big traces. Setup cost limits adoption. |
| **CodeRabbit** | LLM PR walkthrough with change summary and **Mermaid sequence diagrams** "for PRs that affect component interactions" ([docs](https://docs.coderabbit.ai/pr-reviews/walkthroughs)) | Widely used, $1.5B valuation reported ([HN 49274706](https://hn.algolia.com/api/v1/search?query=coderabbit&tags=story)). Evidence on how diagrams are received is anecdotal and vendor-adjacent ([NeuronFeed](https://neuronfeed.com/reviews/coderabbit-review)) | Diagrams only when interactions change. Collapsed by default. No drill-down or code grounding beyond the diff. |
| **Greptile** | Indexes a repo graph (functions, calls, imports), generates docstrings, and has an agent search the graph during review ([docs](https://greptile.com/docs/how-greptile-works/graph-based-codebase-context)). Claims a sequence diagram on every PR (search snippet; page now 404s, **unverified**) | Active product | A graph of callers and dependents gives impact. Same approach we need for "who else is affected". |
| **GitHub Copilot PR summaries** | LLM summary of the diff | GitHub says the author must check accuracy ([responsible use](https://docs.github.com/en/copilot/responsible-use/pull-request-summaries)). PRs with Copilot descriptions needed less review time and were more likely to merge ([Xiao et al.](https://arxiv.org/abs/2402.08967)) | Text summaries help, but carry hallucination risk. Developers often edit them. |
| **Gemini Code Assist (GitHub)** | LLM summary plus severity-ranked review comments; `/gemini summary` ([Google docs](https://docs.cloud.google.com/gemini/docs/code-review/use-code-assist-github)) | Active | Same pattern as Copilot; no diagrams documented. |
| **Graphite** | Stacked PRs and AI review | Acquired by Cursor in Dec 2025. Cursor's CEO said review "looks the same as it did three years ago" ([TechCrunch](https://techcrunch.com/2025/12/19/cursor-continues-acquisition-spree-with-graphite-deal)) | The industry sees review as the bottleneck. Small stacked changes fit behaviour-sized explanations. |
| **DeepWiki / Devin Wiki** | LLM wiki for a whole repo with architecture diagrams and source links. Steerable via `.devin/wiki.json`, up to 30 pages (80 for enterprise) ([Devin docs](https://docs.devin.ai/work-with-devin/deepwiki); [launch](https://cognition.com/blog/deepwiki)) | 50k+ repos indexed at launch. HN reports convincing hallucinations, "handwavy" diagrams, focus on trivia ([HN 45002092](https://hn.algolia.com/api/v1/items/45002092)) | Whole-repo, page-oriented, explains the codebase not the change. Wrong-but-confident output does real harm. |
| **Google Code Wiki** | Gemini-generated wiki, regenerated on every change; architecture, class and sequence diagrams; links to every symbol ([InfoQ](https://www.infoq.com/news/2025/11/google-code-wiki)) | Public preview Nov 2025; Gemini CLI extension for private repos announced | Keeps itself fresh and links symbols both ways. Critics asked what it adds when an agent can read the code directly. |
| **Swimm** | Documentation coupled to code snippets, kept in step by patented auto-sync; checks PRs for docs made stale ([Swimm blog](https://swimm.io/blog/how-swimms-github-app-works)) | Repositioned toward legacy and mainframe understanding with deterministic static analysis (secondary sources, **unverified**) ([devtune](https://devtune.ai/verticals/documentation-developer-portals/swimm)) | Anchoring explanations to code snippets with staleness detection is a proven pattern for "snippets on demand". |
| **Sourcegraph Cody** | Code-graph retrieval plus LLM | Cody Free and Pro discontinued July 2025; Amp spun out ([Sourcegraph blog](https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans)) | Code search stayed; the chat assistant moved on. Not a visualisation lesson as such. |
| **CodeViz (YC S24)** | LSP call graph without LLM, plus an LLM-built nested C4-style architecture view ([HN launch 41393458](https://hn.algolia.com/api/v1/items/41393458)) | Active. HN raised domain bias (a robotics repo forced into "front-end/back-end"), privacy, pricing | A **hybrid** design: LSP for facts, LLM for grouping. Local-only operation was a top request. |
| **CodeBoarding** (OSS) | Static analysis extracts relationships; LLM names and groups components; nested component diagrams; `--depth-cap 3`; incremental re-analysis; GitHub Action shows architecture changes on PRs ([README](https://github.com/CodeBoarding/CodeBoarding)) | About 2.6k stars ([README](https://github.com/CodeBoarding/CodeBoarding)) | The closest open-source analogue to our drill-down. Shows "changed components and dependencies" alongside diffs. |
| **Archify** (agent skill) | The agent writes typed JSON, which is **validated against repo evidence** and rendered by a deterministic compiler to HTML/SVG; nodes link to source lines ([guide](https://betterstack.com/community/guides/ai/archify-architecture.md)) | Popular skill for Claude Code, Codex and others; star counts conflict (8.2k vs 83k, **unverified**) ([repo](https://github.com/tt-a1i/archify)) | The verification architecture to copy: fail-closed, one question per diagram, architecture diffs. |
| **Cartograph** (Claude Code plugin) | Skill explores the code, emits a Mermaid flowchart with ≤15–20 nodes, renders it via a Mermaid MCP and retries up to twice on syntax errors ([listing](https://openskillindex.com/skills/athola-claude-night-market-architecture-diagram)) | Community | Node caps and a render-and-repair loop are already established patterns. |
| **Structurizr / C4** | A model written as code (DSL), with diagrams as views of it; dynamic views; component finder over bytecode or source ([DSL docs](https://docs.structurizr.com/dsl/language); [component finder](https://docs.structurizr.com/java/component)) | The reference tool for C4 | Separate the model from its views so one model can produce many diagrams. |
| **IcePanel** | Hand-curated C4 model with objects linked to repos and cloud resources; alerts when links break ([HN 34338995](https://hn.algolia.com/api/v1/items/34338995)) | YC W23. The founder doubts auto-generation and calls staleness organisational | Linking models to reality and detecting broken links. |
| **Ilograph** | Model-based interactive diagrams: perspectives, contexts, level-of-detail slider, walkthroughs ([about](https://www.ilograph.com/blog/posts/about-ilograph/); [walkthroughs](https://blog.ilograph.com/posts/feature-spotlight-walkthroughs/)) | Active | Walkthroughs suit stepping through a happy path. Selecting a node to focus it, and clicking again to go up to its parent, is a good navigation model. |
| **SciTools Understand** | Static butterfly graphs (calls and called-by) with depth controls ([docs](https://docs.scitools.com/graphs/Calls_and_Called_By.html)) | Long-lived commercial tool | Start shallow and expand nodes on demand. |
| **NDepend** | Dependency graph plus dependency structure matrix; graphs were unreadable beyond a few dozen boxes before 2020.1 ([NDepend blog](https://blog.ndepend.com/visualize-code-with-software-architecture-diagrams)) | Long-lived (.NET) | Graphs stop scaling quickly. Use clustering, or a matrix for large structures. |
| **jQAssistant** | Scans code into Neo4j; architecture rules written as Cypher queries ([hascode](https://hascode.com/software-architecture-exploration-and-validation-with-jqassistant-neo4j-and-cypher)) | OSS | Checkable rules about seams, such as layer access, are possible. |
| **OpenTelemetry service graph** | Pairs client and server (or producer and consumer) spans into service edges with request and failure counts ([README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/servicegraphconnector/README.md)) | Alpha | A runtime source of container-level edges and **failure rates per edge**, useful for showing error propagation. |
| **Code-graph MCP servers** | Tree-sitter or LSP graphs with callers, callees and impact tools (e.g. codebase-memory-mcp, symgraph, code-graph-mcp tracing HTTP route to handler to DB) ([pkg.go.dev](https://pkg.go.dev/github.com/TUPATRIMONIO/codebase-memory-mcp); [docs.rs/symgraph](https://docs.rs/symgraph); [code-graph-mcp](https://cdn.jsdelivr.net/npm/@sdsrs/code-graph@0.32.3/README.md)) | Many small community projects | Candidate fact back-ends. Route-to-handler-to-DB tracing is exactly the happy-path skeleton. |

### 1.2 Per-tool notes

**CodeSee.** Review Maps were generated automatically on every PR and posted as an image in GitHub. They showed changed files, their key dependencies and "logical clusters of files that should be reviewed together", and could be opened in VS Code with file diffs ([docs](https://docs.codesee.io/docs/review-maps-for-visual-studio-code); [learn.codesee.io](https://learn.codesee.io/introducing-the-codesee-review-maps-extension)). The maps worked at **file** granularity and showed **structure** rather than behaviour. The shutdown post (on Daniel Ivanyi's LinkedIn; author and year not confirmed) says new customer logos more than doubled in 2023, but sales were inconsistent. It also says solving code understanding needed "more complex codebases, more IDEs, more tech stacks, and more programming languages", and that generative AI made the space more complex ([LinkedIn, unverified](https://sk.linkedin.com/in/daniel-ivanyi-16845458)). GitKraken announced the acquisition on 14 May 2024 ([HN 40361461](https://hn.algolia.com/api/v1/search?query=codesee&tags=story)). NanoAPI forked the open-source part after CodeSee went closed-source ([HN 42114034](https://hn.algolia.com/api/v1/items/42114034)). On the CodeViz launch thread, a commenter noted CodeSee had shut down after the acquisition ([HN 41393458](https://hn.algolia.com/api/v1/items/41393458)).

**Sourcetrail.** Founded after its creator spent about a month at Google Chrome on a feature he expected to take hours ([Wikipedia](https://en.wikipedia.org/wiki/Sourcetrail)). Released as open source in November 2019, with Patreon funding, and discontinued in 2021 ([Wikipedia](https://en.wikipedia.org/wiki/Sourcetrail)). The original announcement is at sourcetrail.com/blog/discontinue_sourcetrail, but it was not fetchable here, so the official reasons are **unverified**. A third-party post says Patreon did not attract enough patrons ([toroid.org via search](https://toroid.org/sourcetrail-future), not directly fetched). HN reasons given in the discontinuation thread ([28637193](https://hn.algolia.com/api/v1/items/28637193)):
- scottrogowski: call-graph visualisers are something "you would need only once".
- fxtentacle: "There's no customer pain to alleviate."
- jschwartzi: is it better than go-to-definition?
- andijcr: language features will outpace the indexer.

On the 2017 launch thread ([14612440](https://hn.algolia.com/api/v1/items/14612440)), the developer said the graph stays comprehensible "by showing only one level of dependencies". The most common request was more languages.

**AppMap.** Records runtime traces with agents for Ruby, Python, Java and Node.js, from tests, requests or remote recording ([docs](https://appmap.io/docs/appmap-docs.html)). The sequence diagram has these features ([diagram guide](https://appmap.io/docs/reference/guides/using-appmap-diagrams.html)):
- one lifeline per **package**, which can be hidden;
- `[-]`/`[+]` to collapse and expand calls;
- a depth control;
- non-HTTP root events filtered out by default when HTTP requests exist;
- a "diff" between similar AppMaps to show behaviour changes after an update;
- export to SVG and **PlantUML**;
- generation from the CLI in CI.

A Runtime Code Review GitHub Action reported behaviour changes, API changes (as OpenAPI diffs), and performance and security findings per PR ([The New Stack headline](https://thenewstack.io/appmap-releases-runtime-code-review-as-a-github-action/); [Marketplace](https://github.com/marketplace/get-appmap)). An AppMap author's post shows before-and-after recordings attached to a PR, revealing an N+1 query (1,501 vs 3 queries) ([DEV](https://dev.to/appmap/make-performance-fixes-easy-to-review-by-showing-the-before-and-after-l99)). Adoption signals are modest: the appmap-js repo has 54 stars ([GitHub](https://github.com/getappmap/appmap-js)), and the 2023 Show HN got 5 points ([HN](https://hn.algolia.com/api/v1/search?query=appmap&tags=story)). The product now presents itself as "Navie, an AI code architect" built on that runtime data ([docs](https://appmap.io/docs/appmap-docs.html)).

**CodeRabbit.** The walkthrough comment contains these sections, each configurable ([docs](https://docs.coderabbit.ai/pr-reviews/walkthroughs)):
- a changed-files summary grouped into rows;
- sequence diagrams ("Mermaid diagrams showing updated component interactions, such as API calls, event flows, and async workflows"), only for PRs that affect component interactions, controlled by `sequence_diagrams`;
- an estimated review effort from 1 to 5;
- related issues and PRs, suggested reviewers;
- an optional poem.

The walkthrough is collapsed by default. The only first-hand rating of the diagrams found is an affiliate review calling the summary and diagram "massively useful" for a cold 1,500-line PR ([NeuronFeed](https://neuronfeed.com/reviews/coderabbit-review)), so **reception is unverified**. A 2025 security write-up on CodeRabbit drew 687 points on HN ([HN 44953032](https://hn.algolia.com/api/v1/search?query=coderabbit&tags=story)). That is a reminder that review bots run with powerful repository access.

**GitHub Copilot PR summaries.** GitHub's responsible-use page says reviewing the summary's accuracy remains the author's responsibility, and that it is meant "to supplement rather than replace" human context ([GitHub docs](https://docs.github.com/en/copilot/responsible-use/pull-request-summaries)). A study of 18,256 PRs found Copilot-assisted PRs had shorter review times and were more likely to merge, and that developers often add manual edits ([arXiv 2402.08967](https://arxiv.org/abs/2402.08967)).

**DeepWiki.** Launched 5 May 2025 with more than 50,000 repos indexed ([Cognition](https://cognition.com/blog/deepwiki)). A `.devin/wiki.json` file lets maintainers specify pages and notes, which skips the default clustering ([Devin docs](https://docs.devin.ai/work-with-devin/deepwiki)). HN thread "DeepWiki: Understand Any Codebase", 231 points ([45002092](https://hn.algolia.com/api/v1/items/45002092)):
- jcranmer: an LLVM pipeline diagram was wrong, and the result was "distinctly worse" than reading the code.
- IceHegel: diagrams "too handwavy to be useful" and not tied to the implementation.
- swiftcoder: focused on trivial details while glossing over the important parts.
- ignoramous: "hallucinating pretty convincingly".
- tacker2000: people will take these as official docs.
- conartist6: asked for an opt-out.
- Counterpoint, nikisweeting: "one of the few strictly net positive AI coding tools".

**Google Code Wiki.** Generates and regenerates a wiki on every change, with architecture, class and sequence diagrams and links to every symbol. One Reddit critic argued the CLI can already read the code directly ([InfoQ](https://www.infoq.com/news/2025/11/google-code-wiki)).

**CodeViz.** Launch thread, 189 points ([HN 41393458](https://hn.algolia.com/api/v1/items/41393458)). The call graph is built with language servers and no LLM. The architecture view is built by detecting important files and then using LLMs "to build nested architecture diagrams". Pain points raised:
- domain bias (pthangeda: a robotics repo forced into web layers);
- doubt about agreement with maintainers' own diagrams (alixanderwang);
- code leaving the machine (tediousgraffit1: "I can't send my company's IP");
- monorepos too large (kridsdale3);
- unclear edge semantics (Veuxdo: do lines always mean dependency?).

**CodeBoarding.** "Static analysis extracts code relationships; language models help name and describe the components." It produces `analysis.json` with source references and nested component diagrams, and Mermaid, HTML, MDX or RST output. `--depth-cap` (default 3) is "a maximum, not a target depth". `incremental` re-analyses against a fingerprint baseline. A PR view shows "changed components and dependencies" next to the diffs ([README](https://github.com/CodeBoarding/CodeBoarding)).

**Archify.** Diagramming is treated as compilation ([Better Stack guide](https://betterstack.com/community/guides/ai/archify-architecture.md)):
1. The agent emits typed JSON for nodes and edges.
2. The validator cross-checks each component against "repo evidence" and fails closed, with diagnostics.
3. A deterministic compiler renders self-contained HTML/SVG.

Clicking a node opens its source lines. Prompts cap diagrams at 8–12 nodes and tell the agent to omit anything it cannot prove. Committed JSON enables architecture diffs (Added, Removed, Moved, Rerouted). Stated limits: the HTML does not render in GitHub READMEs, and broad scopes become too dense. The README lists architecture, workflow, sequence, data-flow and lifecycle modes ([repo](https://github.com/tt-a1i/archify)). Star counts conflict, so treat them as **unverified**.

**Structurizr / IcePanel / Ilograph (model-based tools).**
- Structurizr's DSL separates the model from its views. Dynamic views show instances of relationships from the static model, ordered, within a scope ([DSL docs](https://docs.structurizr.com/dsl/language)). Simon Brown criticises one-file-per-diagram tools such as PlantUML and Mermaid because they cause inconsistency at scale ([Brown, dev.to](https://dev.to/simonbrown/software-architecture-diagrams-which-tool-should-we-use-29e); [DevNexus abstract](https://devnexus.com/archive/devnexus2022/speakers/3246)).
- The IcePanel founder said of auto-generation: "we don't see this working as great as they believe" ([HN 34339499](https://hn.algolia.com/api/v1/items/34338995)).
- Ilograph's walkthroughs isolate and zoom into part of the architecture step by step, and a level-of-detail slider widens or narrows the view ([walkthroughs](https://blog.ilograph.com/posts/feature-spotlight-walkthroughs/); [about](https://www.ilograph.com/blog/posts/about-ilograph/)).

**Other static tools.**
- Understand recommends starting butterfly graphs at small depth and expanding nodes as needed ([SciTools](https://docs.scitools.com/graphs/Calls_and_Called_By.html)).
- NDepend preferred the dependency matrix for a long time because "it scales better", and adds automatic clustering to graphs ([NDepend](https://blog.ndepend.com/visualize-code-with-software-architecture-diagrams)).
- jQAssistant stores structure in Neo4j and fails a rule when its Cypher query returns rows ([hascode](https://hascode.com/software-architecture-exploration-and-validation-with-jqassistant-neo4j-and-cypher)).
- Diffblue: not researched. Out of scope (test generation).

---

## 2. Research findings

### 2.1 What reviewers need

- **Understanding is the bottleneck.** Bacchelli & Bird studied Microsoft through observation, interviews with 17 developers, surveys of 165 managers and 873 programmers, and 570 classified comments ([DX summary](https://getdx.com/research/outcomes-and-challenges-of-code-review/)). They found that understanding is the key aspect, and that current tools mostly do not meet developers' understanding needs ([abstract](https://microsoft.com/en-us/research/?p=164195)). Reviewers spend most of their time grasping context, descriptions are often unhelpful, tools highlight diffs but not rationale, and reviewers unfamiliar with the code tend to review superficially ([slide summary](https://plg.uwaterloo.ca/~migod/846/current/summaries/10-Haonon-ModernCodeReview-slides.pdf)). The paper also reports that review is less about defects than expected and more about knowledge transfer and awareness ([same](https://plg.uwaterloo.ca/~migod/846/current/summaries/10-Haonon-ModernCodeReview-slides.pdf)).
- **The "Code Reviewing in the Trenches" study.** It covers challenges and tool needs at Microsoft ([IEEE Software](https://ieeexplore.ieee.org/document/7950877); [MSR TR-2016-27](https://www.microsoft.com/en-us/research/?p=238346)). The full text could not be extracted here, so its specific percentages are **unverified**.
- **Google's practice.** Changes are small: roughly 90% touch fewer than 10 files, a typical change is about 24 lines, and 75% of reviews have one reviewer ([Greiler's summary of Sadowski et al.](https://www.michaelagreiler.com/code-reviews/), secondary; [paper](https://research.google/pubs/modern-code-review-a-case-study-at-google/)). Google's reviewer guide says to "Take a broad view of the change", then examine the main parts first, then the rest "in an appropriate sequence". Reading tests first can clarify intent ([eng-practices](https://google.github.io/eng-practices/review/reviewer/navigate.html)). Google suggests about 100 lines is reasonable and about 1,000 is too big. Refactorings belong in separate CLs ([small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)).
- **Size and attention.** SmartBear's Cisco study recommends reviewing under 200–400 LOC at a time ([summary](https://tekin.co.uk/2020/05/proof-your-thousand-line-pull-requests-create-more-bugs); [Atlassian](https://www.atlassian.com/blog/add-ons/code-review-best-practices)). Files shown earlier get more comments ([arXiv 2208.04259](https://arxiv.org/pdf/2208.04259); [arXiv 2506.10654](https://arxiv.org/pdf/2506.10654)). Baum et al. connect working-memory capacity and the order of change parts to review performance ([EMSE 2019 record](https://www.zora.uzh.ch/entities/publication/245eb643-3ebd-476c-a613-8097ff6d9582)). **Implication: presentation order is a design lever.** Lead with the behaviour's entry point and happy path, not alphabetical files.
- **Decomposition.** Over 40% of Microsoft changesets could be split. Grouping diff regions by def-use links produced partitions that 16 of 20 developers judged correct ([Acolyer on Barnett et al.](https://blog.acolyer.org/2015/06/26/helping-developers-help-themselves-automatic-decomposition-of-code-review-changes/)). A controlled experiment with 28 developers found fewer false alarms and more context-seeking, but no measured gain in defects found ([arXiv 1805.10978](https://arxiv.org/abs/1805.10978)).
- **Rubber-stamping.** In five large projects, 64.7% of PRs had comment-free reviews. These showed the "LGTM smell" 3.5× more often and had more commits after approval ([Bilkent repository, ICSME 2024](https://repository.bilkent.edu.tr/items/eb456249-b19d-4c99-9dfb-6ba115f1ecb3)).
- **LLM assistance in review.** In a field study with 10 developers, AI-led summaries up front were generally preferred for large or unfamiliar PRs, but trust and false positives were concerns ([arXiv 2505.16339](https://arxiv.org/abs/2505.16339)).

### 2.2 Accuracy of LLM-generated change explanations

- In 23,247 agent PRs, 1.7% had high message-code inconsistency. The most common type (45.4%) was descriptions claiming changes that were never implemented. Those PRs were accepted 28.3% vs 80.0% of the time and took 3.5× longer to merge ([arXiv 2601.04886](https://arxiv.org/abs/2601.04886)).
- GitHub itself warns of "hallucination" in Copilot summaries generated in Desktop ([GitHub docs](https://docs.github.com/en/enterprise-cloud@latest/copilot/responsible-use/copilot-in-github-desktop)).
- Diagram generation is evaluated in only a few places:
  - MermaidSeqBench scores natural language → Mermaid sequence diagrams, including an "error handling" criterion ([arXiv 2511.14967](https://arxiv.org/abs/2511.14967)).
  - Code2UML (Claude Agent SDK, deterministic IR compaction) reports 91.5% syntactic validity and relationship precision of 0.858, but entity recall of 0.313 ([arXiv 2605.24453](https://arxiv.org/abs/2605.24453)). That means high precision with deliberately low coverage, which suits review.
  - A NeurIPS 2026 benchmark names a "render-constraint gap": diagrams that render but break structural constraints ([NeurIPS](https://neurips.cc/virtual/2026/173008); details from search snippet, **partially unverified**).

### 2.3 Program comprehension and information needs

- Sillito et al. catalogued 44 question types programmers ask during change tasks, in four categories by scope ([UBC thesis](https://open.library.ubc.ca/collections/831/items/1.0052042)).
- LaToza & Myers collected 371 hard-to-answer questions from 179 developers. The largest categories were about intent and rationale. Reachability questions were rated hard by 82% ([PLATEAU slides](https://ecs.wgtn.ac.nz/foswiki/pub/Events/PLATEAU/2010Program/plateau10-latoza-slides.pdf); [ACM record](https://www.springerprofessional.de/doi/10.1145/1937117.1937125)). In a lab study, about half of erroneous changes came from misunderstanding reachability ([MSR "Get Me Here"](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/getmehere-tr.pdf), via search summary).
- **Information foraging theory.** Programmers navigate by following "scent" (cues such as words in identifiers) across "topology" (links). An executable model based on scent predicted navigation better than models without it ([Lawrance et al., TSE 2013](https://web.engr.oregonstate.edu/~burnett/Reprints/TSE-IFT-2013-asprinted.pdf)). A later paper derived design patterns for tools ([Fleming et al., TOSEM 2013](https://digitalcommons.memphis.edu/facpubs/2490)). **Implication: node labels are scent.** Use domain names and verbs ("validates order", "charges card"), and make every node a link (topology) to the next level down.

### 2.4 Diagram use and the visualisation adoption gap

- Developers draw mainly transient whiteboard sketches; converting them to durable form costs too much ([Cherubini et al., CHI 2007](https://faculty.washington.edu/ajko/papers/Cherubini2007DevelopersDrawCode.pdf); [Never Work in Theory](https://neverworkintheory.org/2011/06/30/lets-go-to-the-whiteboard.html)).
- Petre interviewed 50 professionals. 35 used no UML, 11 used it selectively and none used it wholeheartedly. Class, sequence and activity diagrams were the most used. Reasons for not using UML included keeping models in sync ([Never Work in Theory review](https://neverworkintheory.org/2013/06/13/uml-in-practice-2.html); [paper](https://www.ics.uci.edu/~andre/informatics223s2017/petre.pdf)). **Sequence diagrams are among the few UML forms practitioners actually use.**
- About 62% of published software-visualisation approaches had no evaluation. The authors attribute low adoption to unproven effectiveness ([Merino et al., JSS 2018](https://scg.unibe.ch/research/softvis-eval)).
- Professionals have low familiarity with visualisation tools ([arXiv 2401.09605](https://arxiv.org/abs/2401.09605)). Barriers include tool overhead and perceived complexity ([IEEE Access 2014 via DOAJ](https://doaj.org/article/6a87970198574d7c8ce763c2142c607e)). Practitioners want tools integrated into the IDE or documentation ([SPViz industrial study, arXiv 2401.17063](https://arxiv.org/pdf/2401.17063)). Research tools tend to have short lives ([Lanza, CodeCrawler lessons](https://scg.unibe.ch/archive/papers/Lanz03aLessonsLearned.pdf)).
- Graph visualisations built specifically for review exist: ReviewVis, Fregnan et al.'s dependency graph, and execution-trace diffs (Kanda et al.). Their evaluations are mostly small and based on perception ([ReviewVis](https://www.zora.uzh.ch/entities/publication/7e55e778-46a1-4a5c-8aca-b776ce1523dd/full); [survey arXiv 2602.13377](https://arxiv.org/pdf/2602.13377)).

---

## 3. Developer frustrations and desires (themed)

**A. Diagrams rot.**
- Upkeep takes "a lot of manual effort", and the hard part is hooking doc updates into the development cycle ([HN 31370268](https://hn.algolia.com/api/v1/items/31370268)).
- Teams won't spend time keeping detailed diagrams updated (Mandatum), and documentation is "just not a priority" (makestuff) ([HN 34338995](https://hn.algolia.com/api/v1/items/34338995)).
- Documentation goes unused because it is outdated ([Cherubini et al.](https://faculty.washington.edu/ajko/papers/Cherubini2007DevelopersDrawCode.pdf)).
- **Desire:** generate or validate diagrams from code (sbuccini) and navigate C4 levels in a zoomable map (tra3) ([HN 34338995](https://hn.algolia.com/api/v1/items/34338995); [HN 31370268](https://hn.algolia.com/api/v1/items/31370268)).
- **Our answer:** generate on demand per PR, so there is nothing to keep fresh.

**B. Auto-generated diagrams are noise.**
- Accurate but too low-level to discuss abstractions ([IcePanel](https://icepanel.io/blog/the-model-code-gap)).
- Generated class diagrams show poor abstractions and too many dependencies ([Planview via search](https://blog.planview.com/fr/?p=21352), **unverified**).
- Graphs become "un-understandable" beyond a few dozen boxes ([NDepend](https://blog.ndepend.com/visualize-code-with-software-architecture-diagrams)).
- "Never found auto-generated diagrams helpful yet" ([HN 41393458](https://hn.algolia.com/api/v1/items/41393458)).
- Unclear edge semantics ([Veuxdo, same thread](https://hn.algolia.com/api/v1/items/41393458)).
- Brown's diagram checklist: label every line with intent, state the technology, give a key, avoid bidirectional arrows ([Brown](https://dev.to/simonbrown/how-to-review-a-software-architecture-diagram-6p0)).

**C. Trust and hallucination.**
- DeepWiki: convincing hallucinations, wrong pipeline diagrams, a false bug report that cost about an hour (caboteria) ([HN 45002092](https://hn.algolia.com/api/v1/items/45002092)).
- AI reviewers bring "false confidence" (davebren) and flag trivial things (gargola) ([HN 48587808](https://hn.algolia.com/api/v1/items/48587808)).
- Copilot's false-positive rate is much higher than BugBot's ([HN 49321400](https://hn.algolia.com/api/v1/items/49321400)).
- Developers run several models and then filter out hallucinations (montfort) ([HN 48587808](https://hn.algolia.com/api/v1/items/48587808)).
- **Desire:** verifiable, grounded output.

**D. Review pain: size, context, intent.**
- Large or tangled diffs ([Barnett et al.](https://blog.acolyer.org/2015/06/26/helping-developers-help-themselves-automatic-decomposition-of-code-review-changes/)) and comment-free approvals ([ICSME 2024](https://repository.bilkent.edu.tr/items/eb456249-b19d-4c99-9dfb-6ba115f1ecb3)).
- AI misses how new code interacts with business logic "at a macro level" (vunderba) ([HN 38212983](https://hn.algolia.com/api/v1/items/38212983)).
- With AI-written code, "the reviewable unit shouldn't be the final diff" (ArnaudDebray). Others review the agent's "decision trace" instead (BonanKou) ([HN 49321400](https://hn.algolia.com/api/v1/items/49321400)).
- **Desire:** review behaviour and intent, not lines.

**E. Privacy, scale, cost.**
- Requests for local-only operation and bring-your-own key; monorepos too big ([HN 41393458](https://hn.algolia.com/api/v1/items/41393458)).
- Questions about multi-repo support; runs taking more than 10 minutes ([HN 45002092](https://hn.algolia.com/api/v1/items/45002092)).
- A Claude Code plugin already runs under the user's existing model and data agreement. That addresses the "code leaves my machine to a new vendor" objection, but token cost on large repos still matters.

**F. Occasional need.**
- Visualisers are wanted only occasionally, which makes them hard to sell ([HN 28637193](https://hn.algolia.com/api/v1/items/28637193)).
- **Implication:** make the plugin zero-setup and invocable on demand, ideally as a step in PR review, not a destination to visit.

---

## 4. C4 and abstraction-level guidance

- **Levels.** System context → containers → components → code, described as "maps of your code" at different zoom levels, like Google Maps ([c4model.com/introduction](https://c4model.com/introduction); [InfoQ article](https://www.infoq.com/articles/C4-architecture-model/)).
- **Common faults in ad hoc diagrams.** Unexplained notation, unlabelled relationships, generic terms like "business logic", missing technology choices, and **mixed levels of abstraction** ([c4model.com/introduction](https://c4model.com/introduction)). When a big diagram is split, each part should keep the same level of abstraction ([C4 FAQ](https://c4model.com/faq)).
- **Level 4 (code) is optional.** It is "not recommended for anything but the most important or complex components". Show only the members that support the story. Code diagrams are ideally generated on demand by tools ([c4model.com/diagrams/code](https://c4model.com/diagrams/code)). Brown: you can obtain them on demand from most IDEs ([InfoQ](https://www.infoq.com/articles/C4-architecture-model/)).
- **Level 3 (component)** diagrams should be created "only... if you feel they add value". For long-lived documentation, automate them ([c4model.com/diagrams/component](https://c4model.com/diagrams/component)). Components are not packages, folders or JARs by default. A component is "a grouping of related functionality encapsulated behind a well-defined interface", and large codebases may need reverse engineering to find them ([c4model.com/abstractions/component](https://c4model.com/abstractions/component)).
- **Dynamic diagrams** show how static elements collaborate at runtime for one feature, story or use case. They can show systems, containers **or** components. Either collaboration (numbered) or sequence notation is fine. Use them "sparingly" for interesting or complicated flows ([c4model.com/diagrams/dynamic](https://c4model.com/diagrams/dynamic)). Structurizr dynamic views show *instances* of static relationships, so behaviour diagrams sit on top of the structural model ([Structurizr DSL](https://docs.structurizr.com/dsl/language)).
- **Model-code gap.** Fairbanks coined the term in *Just Enough Software Architecture*. Converting a model to code and back would not round-trip, because intent such as "0.5 s latency on these endpoints" is invisible in code ([IcePanel](https://icepanel.io/blog/the-model-code-gap)). Brown's 2018 talk frames it as the mismatch between how code is organised and architectural views ([slides](https://s3.amazonaws.com/static.codingthearchitecture.com/presentations/sclondon2018-model-code-gap.pdf)). His remedy is an "architecturally-evident coding style" (naming, package structure, module dependencies) plus models as code ([JetBrains webinar](https://blog.jetbrains.com/idea/2015/02/webinar-recording-software-architecture-as-code/); [slide copy on Scribd](https://www.scribd.com/document/412996304/SoftwareArchitecture-Vs-Code), secondary). The webinar outline includes a segment "Why not auto-generate the diagrams?". Its content was not verifiable here.
- **Modelling vs diagramming.** In "boxes and lines" tools, diagrams can't be validated or queried. A model is "just data" (a directed graph) with diagrams as views on it ([c4model.com/tooling](https://c4model.com/tooling)).
- **Adaptation for us.** C4 assumes you start at the top and zoom in. We want the **starting level to be the lowest level that still contains the whole changed behaviour**:
  - change confined to one component → start at component level and show its neighbours as boundary boxes;
  - change across services → container level;
  - drop to code level only on demand, and only for the changed or critical elements.

  This matches C4's own advice that lower levels are optional and should be used only where they add value ([code](https://c4model.com/diagrams/code); [component](https://c4model.com/diagrams/component)). The model-code gap means that **intent** (why, SLAs, invariants) must come from the PR description, linked issues, ADRs or comments, not from the code alone.

---

## 5. Techniques

### 5.1 Finding hot, critical and load-bearing paths

- **Churn × complexity hotspots.** CodeScene ranks files with high change frequency and low Code Health, then weights by coupling and multi-team activity. In its example, 1.2% of the code took 12.5% of the effort and held 45% of the fixed bugs ([CodeScene docs](https://codescene.io/docs/guides/technical/hotspots.html)). Low-health code had 15× more defects and 124% longer resolution time across 39 codebases. The authors work for CodeScene ([arXiv 2203.04374](https://arxiv.org/abs/2203.04374)). Tornhill's case study: hotspots pinpointed 7 of the 8 most defect-dense parts ([reflectoring review](https://reflectoring.io/book-review-your-code-as-a-crime-scene/)). Exclude noise such as lockfiles and pick a sensible time window (practitioner advice, [smithery skill](https://smithery.ai/skills/avik-creator/git-forensics)).
- **Graph centrality.** PageRank over static dependency graphs recovers "key classes" that developers put in architecture overviews ([Şora, ENASE 2015](https://www.scitepress.org/Papers/2015/54659/54659.pdf)). iFit (ICSE 2023) improves on baselines in 93.75% of cases ([ICSE 2023](https://conf.researchr.org/details/icse-2023/icse-2023-technical-track/29/Identifying-Key-Classes-for-Initial-Software-Comprehension-Can-We-Do-It-Better-)). High fan-in marks a load-bearing seam.
- **Entry points.** HTTP routes, message consumers, CLI commands, scheduled jobs and public API exports anchor the happy path. Some MCP code graphs already trace route → handler → service → DB ([code-graph-mcp](https://cdn.jsdelivr.net/npm/@sdsrs/code-graph@0.32.3/README.md)).
- **Runtime evidence when available.** OTel servicegraph edges carry request and failure counts ([README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/servicegraphconnector/README.md)). Jaeger SPM provides RED metrics per operation ([Jaeger docs](https://www.jaegertracing.io/docs/2.4)). AppMap gives recorded test traces ([docs](https://appmap.io/docs/reference/guides/using-appmap-diagrams.html)).
- **Change impact for PRs.** Walk callers of changed symbols, as Greptile does ([Greptile docs](https://greptile.com/docs/how-greptile-works/graph-based-codebase-context)). Partition with def-use links, as ClusterChanges does ([Acolyer](https://blog.acolyer.org/2015/06/26/helping-developers-help-themselves-automatic-decomposition-of-code-review-changes/)).

### 5.2 Seams and contracts

- **Feathers.** A seam is "a place where you can alter behavior in your program without editing in that place". Every seam has an **enabling point** where the behaviour is chosen. Object seams (interfaces and injection) are the most common, and constructors are typical enabling points ([LeadDev](https://leaddev.com/technical-direction/how-refactor-legacy-systems-creating-application-seams); [slides citing WELC pp. 31, 36](https://cyberland.ijug.eu/assets/slides/Georg-Berky-Gruene-Inseln-im-Schlamm.pdf)).
- **Ports and adapters.** Ports are purpose-defined APIs at the application boundary, and adapters are technology-specific plug-ins ([Cockburn](https://alistair.cockburn.us/hexagonal-architecture/)). C4 components sit "behind a well-defined interface" ([c4model](https://c4model.com/abstractions/component)).
- **Contracts at external boundaries** are pinned by contract tests ([Fowler](https://martinfowler.com/bliki/ContractTest.html)). Rules about seams (e.g. layer access) can be checked as graph queries ([jQAssistant](https://hascode.com/software-architecture-exploration-and-validation-with-jqassistant-neo4j-and-cypher)).
- **Heuristics for detecting seams (our synthesis, not from a single source):**
  - interfaces or abstract types with multiple implementations;
  - DI registrations;
  - module or package export surfaces;
  - HTTP, gRPC and message schemas;
  - DB repositories;
  - external SDK calls;
  - feature flags;
  - config-selected strategies.

  Show each seam as a boundary on the diagram, annotated with its contract (the type or schema) and its enabling point.

### 5.3 Error-flow visualisation

- Mermaid sequence diagrams support `alt/else`, `opt`, `critical/option` (failure handling) and `break` (stop the sequence, typically an exception) ([Mermaid docs](https://mermaid.js.org/syntax/sequenceDiagram.html)). MermaidSeqBench explicitly scores "error handling" ([arXiv 2511.14967](https://arxiv.org/abs/2511.14967)).
- Static exception-flow analysis has a long history. Jex computed the exceptions possible at each program point, shown against the handler structure, and found accidental catches and missed recovery points ([Robillard & Murphy, FSE 2000](https://www.cs.mcgill.ca/~martin/papers/fse2000.pdf); [TOSEM 2003](https://www.cs.mcgill.ca/~martin/papers/tosem2003.pdf); [Jex page](https://cs.mcgill.ca/~swevo/jex)). Unchecked exceptions and subsumption make manual reasoning hard ([UBC TR-99-02](https://cs.ubc.ca/tr/1999/tr-99-02)).
- **Proposed rendering:**
  - Draw the happy path first.
  - Add an "error overlay" on request: for each seam crossing, where errors originate, how they are transformed (wrap, map to status code, retry, swallow), and where they are finally handled.
  - Highlight swallowed or accidental catches. Jex identified this category of finding.

### 5.4 Rendering and interactivity

- **Mermaid.**
  - Flowchart `click nodeId callback` / `click nodeId href "url"` with tooltip. These need `securityLevel: 'loose'` and are disabled under `strict` ([flowchart docs](https://mermaid.js.org/syntax/flowchart.html); [config](https://mermaid.js.org/config/schema-docs/config.html)). `securityLevel` can only be set via `mermaid.initialize`, not in-diagram directives ([config](https://mermaid.js.org/config/schema-docs/config.html)).
  - Sequence diagrams have no click handlers on participants, only actor **link menus** (`link`/`links`) ([sequence docs](https://mermaid.js.org/syntax/sequenceDiagram.html)).
  - Limits: `maxTextSize` 50,000 and `maxEdges` 500 by default ([config](https://mermaid.js.org/config/schema-docs/config.html)). Hosts often hard-code lower limits; GitLab counts link URLs towards its limit ([GitLab MR 60490](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/60490); [Obsidian forum](https://forum.obsidian.md/t/mermaid-diagrams-fail-with-maximum-text-size-exceeded-error-no-way-to-configure-maxtextsize-limit/103484)).
  - Flowcharts now lay out with ELK by default ([flowchart docs](https://mermaid.js.org/syntax/flowchart.html)).
  - GitHub renders Mermaid in issues, PRs and Markdown ([GitHub docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams)), but hyperlinks, tooltips and callbacks are not reliably supported ([gist](https://gist.github.com/LucasArruda/8fd558990bbc187f1a5787ee3d16b301)). GitLab sandboxes Mermaid in an iframe and routes link clicks through postMessage ([GitLab MR 214845](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/214845)).
- **D2.** Boards (`layers`, `scenarios`, `steps`) with `link` to jump between boards and a clickable breadcrumb back to ancestors ([composition](https://d2lang.com/tour/composition); [linking](https://d2lang.com/tour/linking)). This maps naturally to C4-style drill-down in exported SVG. Which export formats preserve navigation is **unverified**.
- **Structurizr DSL.** Model plus views, dynamic views, `url` on elements and relationships ([DSL](https://docs.structurizr.com/dsl/language)). It can export to PlantUML and Mermaid ([Brown](https://dev.to/simonbrown/software-architecture-diagrams-which-tool-should-we-use-29e)).
- **Custom HTML.**
  - elk.js does layered (Sugiyama) layout with ports and Web Worker support, but no rendering ([elkjs](https://github.com/kieler/elkjs)).
  - React Flow recommends dagre for simple trees and elk.js for sub-flows and edge routing, at the cost of complexity and bundle size ([React Flow layouting](https://reactflow.dev/learn/layouting/layouting)).
  - Cytoscape.js supports compound nodes and ELK/dagre/CoSE layouts ([Cytoscape.js](https://js.cytoscape.org/)).
  - Archify's deterministic HTML compiler is a worked example ([guide](https://betterstack.com/community/guides/ai/archify-architecture.md)).
- **Navigation patterns worth copying:**
  - Ilograph: select to focus, click again to go to the parent, level-of-detail slider, walkthroughs ([Ilograph](https://www.ilograph.com/blog/posts/about-ilograph/)).
  - AppMap: hide lifelines, collapse calls, depth control ([AppMap](https://appmap.io/docs/reference/guides/using-appmap-diagrams.html)).
  - Understand: start shallow and expand on demand ([SciTools](https://docs.scitools.com/graphs/Calls_and_Called_By.html)).
  - CodeSee: click to isolate a node's dependencies, double-click to open the diff ([CodeSee docs](https://docs.codesee.io/docs/review-maps-for-visual-studio-code)).

### 5.5 Grounding and verification

- **Deterministic facts, LLM semantics:**
  - CodeViz: LSP call graph without LLM, LLM for architecture ([HN 41393458](https://hn.algolia.com/api/v1/items/41393458)).
  - CodeBoarding: static relationships, LLM names ([README](https://github.com/CodeBoarding/CodeBoarding)).
  - Cartograph (the SaaS, distinct from the Claude Code plugin above): static symbols, LLM fills gaps such as HTTP calls ([HN 42357341](https://hn.algolia.com/api/v1/items/42357341)).
  - Code2UML: deterministic IR compaction before the LLM ([arXiv 2605.24453](https://arxiv.org/abs/2605.24453)).
- **Fail-closed validation.** Archify cross-checks every component against repo evidence and refuses to render invalid input ([guide](https://betterstack.com/community/guides/ai/archify-architecture.md)).
- **Syntax is not truth.** Render-and-repair loops fix syntax (≤2 retries in the Cartograph Claude Code plugin; ≤3 in an HU Berlin pipeline) ([cartograph](https://openskillindex.com/skills/athola-claude-night-market-architecture-diagram); [HU Berlin](https://llm-enabled-development-41d6d8.pages.cms.hu-berlin.de/en/experiments/diagram/diagram-long)). They do not check semantics.
- **Linking back to code.** Code Wiki links every symbol ([InfoQ](https://www.infoq.com/news/2025/11/google-code-wiki)). DeepWiki links to source ([Devin docs](https://docs.devin.ai/work-with-devin/deepwiki)). Swimm flags docs whose referenced code changed ([Swimm](https://swimm.io/blog/how-swimms-github-app-works)).

---

## 6. Implications for our plugin

### 6.1 Design recommendations

| # | Recommendation | Traced to |
|---|---|---|
| R1 | **Decompose first.** For a PR, cluster changed hunks into *behaviours* using def-use, call-graph and entry-point links. Produce one explanation per behaviour, and list pure refactors or mechanical changes separately and briefly. | §2.1 Barnett et al., Di Biase et al.; Google small-CL guidance |
| R2 | **Lead with a one-screen overview**: what behaviours changed, which seams they cross, the risk ranking and the suggested review order. Then the main behaviour, then the rest. | Google "navigate a CL"; file-order studies; Bacchelli & Bird |
| R3 | **Pick the starting level from context.** Choose the lowest C4 level that contains the whole behaviour, and show neighbours as greyed boundary boxes. Never mix levels within one diagram. | §4 C4 introduction/FAQ; user's "context is king" |
| R4 | **One question per diagram, with a node budget of about 7–12 (hard cap ~20).** Anything beyond the budget gets folded into a collapsible group node. | Archify; Cartograph; NDepend; Mermaid limits |
| R5 | **Default to a sequence diagram (or C4 dynamic view) for the happy path** across the chosen elements, with a flowchart or component view for structure. Sequence diagrams are among the few UML forms practitioners actually use. | Petre; C4 dynamic; CodeRabbit; AppMap |
| R6 | **Seams as first-class elements.** Mark each crossing with its contract (type, schema or endpoint) and enabling point (DI binding, config, flag). Changes *to* a contract get highlighted. | Feathers; Cockburn; Fowler contract tests; C4 components |
| R7 | **Error overlay.** For each seam crossing, show where errors originate, how they are transformed and where they are handled, using `alt`/`break`/`critical`. Flag swallowed errors and generic catches. | Mermaid sequence syntax; Jex; LaToza reachability |
| R8 | **Ground everything.** Build an evidence model first (nodes and edges, each with `file:line` and a snippet range), from LSP, tree-sitter or grep. Render from the evidence. The LLM may *name, group and narrate* but may not add edges without evidence. Unproven elements are dropped or visibly marked "inferred". | Archify; CodeBoarding; CodeViz; DeepWiki complaints; PR-MCI study |
| R9 | **Snippets on demand.** Each node and edge links to its exact code range and, for PRs, to the corresponding diff hunk. Keep snippets out of the diagram itself. | C4 "code level on demand"; CodeSee double-click-to-diff; Swimm snippet coupling |
| R10 | **Separate the model from its views.** Persist a JSON behaviour model (elements, relationships, seams, flows, evidence) and render views from it. This enables architecture diffs between base and head, and re-rendering in several formats. | C4 tooling "a model is just data"; Structurizr; Archify JSON IR; CodeBoarding analysis.json |
| R11 | **Two rendering targets.** (a) A static Mermaid summary for PR comments and Markdown, with no click dependency, plain Markdown links beside it, and a size budget well under 50k characters. (b) An interactive self-contained HTML page or artifact for drill-down (ELK layout, click to zoom, breadcrumb back up, snippet panel). | Mermaid security and size limits; GitHub limits; D2 linking; Ilograph navigation |
| R12 | **Default focus for whole-codebase runs.** Rank by entry points × centrality (PageRank or fan-in) × hotspot score (churn × complexity), then explain the top N flows. Optionally use runtime evidence (OTel service graph, AppMap) when present. | CodeScene; Code Red; key-class research; OTel |
| R13 | **Name nodes for information scent.** Use domain verbs and nouns from the code and PR description, never generic labels like "business logic". Label every edge with intent and technology. | Information foraging theory; C4 notation faults; Brown review checklist |
| R14 | **Make intent explicit and sourced.** Pull "why" from the PR description, linked issues and ADRs, and say when intent is missing instead of inventing it. | Model-code gap; LaToza (intent/rationale questions dominate); PR-MCI "claims unimplemented changes" |
| R15 | **Show behaviour diffs, not just behaviour.** For PRs, render base vs head of the same flow, marking added, removed and rerouted steps. | AppMap sequence-diagram diff; Archify architecture diffs; CodeBoarding PR view |
| R16 | **Zero setup, on demand, inside the existing loop.** Run as a Claude Code command or skill in the review flow, with no indexer to install. Reuse LSP and the model already configured. | CodeSee and Sourcetrail failures; adoption-gap research; CodeViz privacy concerns |

### 6.2 Anti-patterns to avoid

| Anti-pattern | Why | Source |
|---|---|---|
| Dumping a full call graph or class diagram ("hairball") | Accurate but useless for reasoning about abstractions; graphs break down beyond a few dozen nodes | IcePanel; NDepend; HN CodeViz thread |
| Always starting at system context | Wastes the reader's attention when the change sits deep in one module; C4 lower levels are on demand | C4 code/component pages |
| Mixing abstraction levels in one diagram | One of C4's listed diagram faults | c4model.com/introduction |
| LLM-invented components or edges ("Kafka that isn't there") | Destroys trust; mismatched descriptions cut acceptance from 80% to 28% | Archify guide; arXiv 2601.04886; DeepWiki HN |
| Unlabelled or ambiguous edges | Readers can't tell dependency from call from data flow | Brown checklist; HN Veuxdo |
| Forcing a domain template ("frontend/backend") onto every repo | Observed bias in CodeViz | HN 41393458 |
| Treating "it renders" as "it's right" | Render-constraint gap | NeurIPS 2026 benchmark |
| Relying on Mermaid `click` inside GitHub comments | Not supported or unreliable; needs `loose` security | Mermaid config; gist |
| Long-lived generated docs that need upkeep | They rot; the plugin should regenerate per request | HN 31370268; Cherubini et al. |
| Alphabetical, file-ordered presentation | Earlier files get disproportionate attention | arXiv 2208.04259; 2506.10654 |
| Trivia-heavy narration | DeepWiki criticised for focusing on trivial details | HN swiftcoder |
| Building and maintaining per-language indexers | Main cost driver for CodeSee and Sourcetrail | CodeSee post; HN 28637193 |

---

## 7. Open questions

1. **Evidence back-end.** Should the plugin rely on Claude Code's LSP tool, tree-sitter, an existing MCP code graph, or plain grep plus reading? This trades accuracy, language coverage and setup cost. Dynamic dispatch, DI and reflection weaken static call graphs ([key-class synthesis caveat](https://www.scitepress.org/Papers/2015/54659/54659.pdf)).
2. **Defining a behaviour boundary in a PR.** Is it entry-point-to-effect, or a def-use cluster? How do we handle PRs that are mostly refactors?
3. **Diagram host.** Can the drill-down UI be a Claude artifact or self-contained HTML, while the PR gets a static Mermaid comment? Do we want a GitHub Action mode like CodeBoarding's?
4. **Verification depth.** Is "every edge has a file:line" enough, or should we also run a second-pass checker (another model, or deterministic checks that the callee is reachable from the caller)?
5. **Runtime integration.** Is it worth importing AppMap or OTel traces when present? How common are they in target repos?
6. **Intent sources.** How much should we lean on PR descriptions or issues that may themselves be wrong (cf. PR-MCI)?
7. **Measuring success.** Merino et al. show the field rarely evaluates. Should we define an evaluation up front, such as review time, defects caught, reviewer confidence calibration, or an accuracy audit of generated edges?
8. **Unverified gaps.** The official reasons for Sourcetrail's discontinuation, the CodeSee shutdown post's author and year, how CodeRabbit's diagrams are received, Greptile's per-PR sequence diagrams, and the Microsoft "Trenches" percentages could not be confirmed from primary text. Fill them if they become decision-relevant.

---

## 8. Sources

### Prior-art tools
- CodeSee docs (Review Maps): https://docs.codesee.io/docs/review-maps-for-visual-studio-code
- CodeSee Review Maps intro: https://learn.codesee.io/introducing-the-codesee-review-maps-extension
- CodeSee shutdown post (LinkedIn, Daniel Ivanyi profile): https://sk.linkedin.com/in/daniel-ivanyi-16845458
- GitKraken acquires CodeSee (repost): https://www.schneider.im/gitkraken-acquired-codesee
- HN CodeSee stories: https://hn.algolia.com/api/v1/search?query=codesee&tags=story
- HN NanoAPI fork: https://hn.algolia.com/api/v1/items/42114034
- Sourcetrail (Wikipedia): https://en.wikipedia.org/wiki/Sourcetrail
- HN "Discontinue Sourcetrail": https://hn.algolia.com/api/v1/items/28637193
- HN Sourcetrail launch: https://hn.algolia.com/api/v1/items/14612440
- AppMap docs: https://appmap.io/docs/appmap-docs.html
- AppMap diagram guide: https://appmap.io/docs/reference/guides/using-appmap-diagrams.html
- AppMap before/after PR post: https://dev.to/appmap/make-performance-fixes-easy-to-review-by-showing-the-before-and-after-l99
- AppMap GitHub Action (The New Stack): https://thenewstack.io/appmap-releases-runtime-code-review-as-a-github-action/
- AppMap Marketplace: https://github.com/marketplace/get-appmap
- appmap-js repo: https://github.com/getappmap/appmap-js
- CodeRabbit walkthroughs: https://docs.coderabbit.ai/pr-reviews/walkthroughs
- CodeRabbit review (affiliate): https://neuronfeed.com/reviews/coderabbit-review
- HN CodeRabbit stories: https://hn.algolia.com/api/v1/search?query=coderabbit&tags=story
- Greptile graph context: https://greptile.com/docs/how-greptile-works/graph-based-codebase-context
- GitHub Copilot PR summaries, responsible use: https://docs.github.com/en/copilot/responsible-use/pull-request-summaries
- Copilot in GitHub Desktop, responsible use: https://docs.github.com/en/enterprise-cloud@latest/copilot/responsible-use/copilot-in-github-desktop
- Gemini Code Assist on GitHub: https://docs.cloud.google.com/gemini/docs/code-review/use-code-assist-github
- Cursor acquires Graphite (TechCrunch): https://techcrunch.com/2025/12/19/cursor-continues-acquisition-spree-with-graphite-deal
- DeepWiki launch: https://cognition.com/blog/deepwiki
- DeepWiki docs: https://docs.devin.ai/work-with-devin/deepwiki
- HN DeepWiki thread: https://hn.algolia.com/api/v1/items/45002092
- Google Code Wiki (InfoQ): https://www.infoq.com/news/2025/11/google-code-wiki
- Swimm GitHub app: https://swimm.io/blog/how-swimms-github-app-works
- Swimm profile (secondary): https://devtune.ai/verticals/documentation-developer-portals/swimm
- Sourcegraph Cody changes: https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans
- HN CodeViz launch: https://hn.algolia.com/api/v1/items/41393458
- HN Cartograph (SaaS): https://hn.algolia.com/api/v1/items/42357341
- CodeBoarding README: https://github.com/CodeBoarding/CodeBoarding
- Archify guide: https://betterstack.com/community/guides/ai/archify-architecture.md
- Archify repo: https://github.com/tt-a1i/archify
- Cartograph Claude Code skill: https://openskillindex.com/skills/athola-claude-night-market-architecture-diagram
- Structurizr DSL: https://docs.structurizr.com/dsl/language
- Structurizr component finder: https://docs.structurizr.com/java/component
- HN IcePanel launch: https://hn.algolia.com/api/v1/items/34338995
- Ilograph about: https://www.ilograph.com/blog/posts/about-ilograph/
- Ilograph walkthroughs: https://blog.ilograph.com/posts/feature-spotlight-walkthroughs/
- SciTools Understand graphs: https://docs.scitools.com/graphs/Calls_and_Called_By.html
- NDepend diagrams: https://blog.ndepend.com/visualize-code-with-software-architecture-diagrams
- jQAssistant walkthrough: https://hascode.com/software-architecture-exploration-and-validation-with-jqassistant-neo4j-and-cypher
- OTel servicegraph connector: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/servicegraphconnector/README.md
- Jaeger docs: https://www.jaegertracing.io/docs/2.4
- codebase-memory-mcp: https://pkg.go.dev/github.com/TUPATRIMONIO/codebase-memory-mcp
- symgraph: https://docs.rs/symgraph
- code-graph-mcp: https://cdn.jsdelivr.net/npm/@sdsrs/code-graph@0.32.3/README.md

### Research
- Bacchelli & Bird, ICSE 2013: https://microsoft.com/en-us/research/?p=164195
- Bacchelli & Bird slide summary: https://plg.uwaterloo.ca/~migod/846/current/summaries/10-Haonon-ModernCodeReview-slides.pdf
- DX summary of Bacchelli & Bird: https://getdx.com/research/outcomes-and-challenges-of-code-review/
- Code Reviewing in the Trenches (IEEE): https://ieeexplore.ieee.org/document/7950877
- MSR TR-2016-27: https://www.microsoft.com/en-us/research/?p=238346
- Sadowski et al. (Google): https://research.google/pubs/modern-code-review-a-case-study-at-google/
- Greiler on Google reviews: https://www.michaelagreiler.com/code-reviews/
- Google eng-practices, navigate a CL: https://google.github.io/eng-practices/review/reviewer/navigate.html
- Google eng-practices, small CLs: https://google.github.io/eng-practices/review/developer/small-cls.html
- ClusterChanges (Acolyer): https://blog.acolyer.org/2015/06/26/helping-developers-help-themselves-automatic-decomposition-of-code-review-changes/
- Change decomposition experiment: https://arxiv.org/abs/1805.10978
- Baum et al., EMSE 2019: https://www.zora.uzh.ch/entities/publication/245eb643-3ebd-476c-a613-8097ff6d9582
- File position in review: https://arxiv.org/pdf/2208.04259
- Review orders mined from GitHub: https://arxiv.org/pdf/2506.10654
- SmartBear/Cisco summary: https://tekin.co.uk/2020/05/proof-your-thousand-line-pull-requests-create-more-bugs
- Atlassian review practices: https://www.atlassian.com/blog/add-ons/code-review-best-practices
- LGTM smells, ICSME 2024: https://repository.bilkent.edu.tr/items/eb456249-b19d-4c99-9dfb-6ba115f1ecb3
- LLM-assisted review field study: https://arxiv.org/abs/2505.16339
- Copilot for PRs study: https://arxiv.org/abs/2402.08967
- PR message-code inconsistency: https://arxiv.org/abs/2601.04886
- MermaidSeqBench: https://arxiv.org/abs/2511.14967
- Code2UML: https://arxiv.org/abs/2605.24453
- Diagram DSL benchmark (NeurIPS 2026): https://neurips.cc/virtual/2026/173008
- HU Berlin diagram validation: https://llm-enabled-development-41d6d8.pages.cms.hu-berlin.de/en/experiments/diagram/diagram-long
- Sillito thesis: https://open.library.ubc.ca/collections/831/items/1.0052042
- LaToza & Myers slides: https://ecs.wgtn.ac.nz/foswiki/pub/Events/PLATEAU/2010Program/plateau10-latoza-slides.pdf
- LaToza & Myers ACM record: https://www.springerprofessional.de/doi/10.1145/1937117.1937125
- Get Me Here (MSR): https://microsoft.com/en-us/research/wp-content/uploads/2016/02/getmehere-tr.pdf
- Lawrance et al., information foraging, TSE 2013: https://web.engr.oregonstate.edu/~burnett/Reprints/TSE-IFT-2013-asprinted.pdf
- Fleming et al., TOSEM 2013: https://digitalcommons.memphis.edu/facpubs/2490
- Cherubini et al., CHI 2007: https://faculty.washington.edu/ajko/papers/Cherubini2007DevelopersDrawCode.pdf
- Never Work in Theory, whiteboard: https://neverworkintheory.org/2011/06/30/lets-go-to-the-whiteboard.html
- Petre, UML in Practice (review): https://neverworkintheory.org/2013/06/13/uml-in-practice-2.html
- Petre paper: https://www.ics.uci.edu/~andre/informatics223s2017/petre.pdf
- Merino et al., SoftVis evaluation: https://scg.unibe.ch/research/softvis-eval
- Onboarding and software visualisation: https://arxiv.org/abs/2401.09605
- IEEE Access 2014 (DOAJ): https://doaj.org/article/6a87970198574d7c8ce763c2142c607e
- SPViz: https://arxiv.org/pdf/2401.17063
- Lanza, CodeCrawler lessons: https://scg.unibe.ch/archive/papers/Lanz03aLessonsLearned.pdf
- ReviewVis: https://www.zora.uzh.ch/entities/publication/7e55e778-46a1-4a5c-8aca-b776ce1523dd/full
- Code review benchmarks survey: https://arxiv.org/pdf/2602.13377
- Code Red (Tornhill & Borg): https://arxiv.org/abs/2203.04374
- CodeScene hotspots: https://codescene.io/docs/guides/technical/hotspots.html
- Your Code as a Crime Scene review: https://reflectoring.io/book-review-your-code-as-a-crime-scene/
- PageRank key classes: https://www.scitepress.org/Papers/2015/54659/54659.pdf
- iFit, ICSE 2023: https://conf.researchr.org/details/icse-2023/icse-2023-technical-track/29/Identifying-Key-Classes-for-Initial-Software-Comprehension-Can-We-Do-It-Better-
- Robillard & Murphy, FSE 2000: https://www.cs.mcgill.ca/~martin/papers/fse2000.pdf
- Robillard & Murphy, TOSEM 2003: https://www.cs.mcgill.ca/~martin/papers/tosem2003.pdf
- Jex: https://cs.mcgill.ca/~swevo/jex
- UBC TR-99-02: https://cs.ubc.ca/tr/1999/tr-99-02

### C4, seams, contracts
- C4 home: https://c4model.com/
- C4 introduction: https://c4model.com/introduction
- C4 code diagram: https://c4model.com/diagrams/code
- C4 component diagram: https://c4model.com/diagrams/component
- C4 dynamic diagram: https://c4model.com/diagrams/dynamic
- C4 component abstraction: https://c4model.com/abstractions/component
- C4 FAQ: https://c4model.com/faq
- C4 tooling: https://c4model.com/tooling
- C4 InfoQ article: https://www.infoq.com/articles/C4-architecture-model/
- C4 (Wikipedia): https://en.wikipedia.org/wiki/C4_model
- Brown, model-code gap slides: https://s3.amazonaws.com/static.codingthearchitecture.com/presentations/sclondon2018-model-code-gap.pdf
- Brown, architecture-as-code webinar: https://blog.jetbrains.com/idea/2015/02/webinar-recording-software-architecture-as-code/
- Brown, which diagram tool: https://dev.to/simonbrown/software-architecture-diagrams-which-tool-should-we-use-29e
- Brown, how to review a diagram: https://dev.to/simonbrown/how-to-review-a-software-architecture-diagram-6p0
- Brown, DevNexus abstract: https://devnexus.com/archive/devnexus2022/speakers/3246
- IcePanel, model-code gap: https://icepanel.io/blog/the-model-code-gap
- Feathers seams (LeadDev): https://leaddev.com/technical-direction/how-refactor-legacy-systems-creating-application-seams
- WELC page citations (slides): https://cyberland.ijug.eu/assets/slides/Georg-Berky-Gruene-Inseln-im-Schlamm.pdf
- Cockburn, hexagonal architecture: https://alistair.cockburn.us/hexagonal-architecture/
- Fowler, contract tests: https://martinfowler.com/bliki/ContractTest.html

### Rendering
- Mermaid config schema: https://mermaid.js.org/config/schema-docs/config.html
- Mermaid flowchart: https://mermaid.js.org/syntax/flowchart.html
- Mermaid sequence diagram: https://mermaid.js.org/syntax/sequenceDiagram.html
- GitHub diagrams docs: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams
- GitHub Mermaid link limitations (gist): https://gist.github.com/LucasArruda/8fd558990bbc187f1a5787ee3d16b301
- GitLab Mermaid sandbox MR: https://gitlab.com/gitlab-org/gitlab/-/merge_requests/214845
- GitLab Mermaid char limit MR: https://gitlab.com/gitlab-org/gitlab/-/merge_requests/60490
- Obsidian maxTextSize thread: https://forum.obsidian.md/t/mermaid-diagrams-fail-with-maximum-text-size-exceeded-error-no-way-to-configure-maxtextsize-limit/103484
- D2 composition: https://d2lang.com/tour/composition
- D2 linking: https://d2lang.com/tour/linking
- elkjs: https://github.com/kieler/elkjs
- React Flow layouting: https://reactflow.dev/learn/layouting/layouting
- Cytoscape.js: https://js.cytoscape.org/

### Developer discussions
- HN, keeping architecture docs up to date: https://hn.algolia.com/api/v1/items/31370268
- HN, AI-assisted review tools (2026): https://hn.algolia.com/api/v1/items/48587808
- HN, human review of AI code (2026): https://hn.algolia.com/api/v1/items/49321400
- HN, AI code review experiences (2023): https://hn.algolia.com/api/v1/items/38212983
