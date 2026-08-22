import { memo, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  Handle,
  MarkerType,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  CircleDot,
  Code2,
  Database,
  FileCode2,
  Filter,
  GitBranch,
  Layers3,
  LocateFixed,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Search,
  ServerCog,
  Settings2,
  Sparkles,
  Users,
  X
} from "lucide-react";
import type { CanvasLayout, GraphEntity, GraphMode, GraphPayload, GraphRelationship, EvidenceRef, ProjectSummary } from "@onto/domain";
import { getEntity, getGraph, getProjects, getRelationship, rerunIngestion, saveLayout } from "./lib/api";

type FlowNode = Node<GraphEntity, "onto">;
type FlowEdge = Edge<GraphRelationship>;

const nodeTypes = { onto: OntologyNode };
const domainPalette = ["#b97960", "#7d9580", "#ca9c5e", "#718297", "#a1849d", "#8d8d71"];

const typeIcon = (type: string) => {
  if (type === "Service") return <ServerCog size={15} />;
  if (type === "APIEndpoint") return <ArrowUpRight size={15} />;
  if (type === "Event") return <Activity size={15} />;
  if (type === "Database") return <Database size={15} />;
  if (type === "DomainEntity") return <Boxes size={15} />;
  if (type === "Schema") return <FileCode2 size={15} />;
  if (type === "Domain") return <Layers3 size={15} />;
  return <CircleDot size={15} />;
};

const typeLabel = (type: string) => ({ APIEndpoint: "API endpoint", DomainEntity: "Domain entity", OntologyType: "Ontology type" }[type] ?? type);

function OntologyNode({ data, selected }: NodeProps<FlowNode>) {
  const isDomain = data.type === "Domain";
  const isOntology = data.type === "OntologyType";
  const aliases = Array.isArray(data.properties?.aliases) ? data.properties.aliases as string[] : [];
  return (
    <div className={`onto-node node-${data.type.toLowerCase()} ${selected ? "is-selected" : ""} ${isDomain ? "is-domain" : ""}`}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="node-topline">
        <span className="node-icon">{typeIcon(data.type)}</span>
        <span className="node-type">{isOntology ? "definition" : typeLabel(data.type)}</span>
        {data.confidence < 0.8 && <span className="node-confidence">weak</span>}
      </div>
      <div className="node-name">{data.name}</div>
      {data.owner && <div className="node-owner">{data.owner}</div>}
      {!isDomain && data.domain && <div className="node-domain">{data.domain}</div>}
      {isOntology && aliases.length > 0 && <div className="node-alias">{aliases.slice(0, 2).join(" · ")}</div>}
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

function makePositions(graph: GraphPayload): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (graph.mode === "ontology") {
    graph.entities.forEach((entity, index) => {
      positions[entity.id] = { x: 120 + (index % 3) * 270, y: 100 + Math.floor(index / 3) * 170 };
    });
    return positions;
  }
  const domains = graph.entities.filter((entity) => entity.type === "Domain");
  const domainIndex = new Map(domains.map((domain, index) => [domain.name, index]));
  domains.forEach((domain, index) => { positions[domain.id] = { x: 40 + index * 360, y: 50 }; });
  const counts = new Map<string, number>();
  graph.entities.filter((entity) => entity.type !== "Domain").forEach((entity) => {
    const key = entity.domain ?? "Unmapped";
    const index = domainIndex.get(key) ?? domainIndex.size;
    const row = counts.get(key) ?? 0;
    counts.set(key, row + 1);
    positions[entity.id] = { x: 40 + index * 360 + (row % 2) * 150, y: 170 + Math.floor(row / 2) * 150 };
  });
  return positions;
}

function toFlow(graph: GraphPayload, storedPositions: Record<string, { x: number; y: number }> = {}): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const positions = makePositions(graph);
  const nodes = graph.entities.map((entity) => ({
    id: entity.id,
    type: "onto" as const,
    position: storedPositions[entity.id] ?? positions[entity.id] ?? { x: 100, y: 100 },
    data: entity,
    draggable: true
  }));
  const edges = graph.relationships.map((relationship) => ({
    id: relationship.id,
    source: relationship.source,
    target: relationship.target,
    data: relationship,
    label: relationship.type,
    type: "smoothstep",
    animated: relationship.type === "CALLS",
    markerEnd: { type: MarkerType.ArrowClosed, color: relationship.origin === "configuration" ? "#a1849d" : "#7d9580" },
    style: { stroke: relationship.origin === "configuration" ? "#a1849d" : "#7d9580", strokeWidth: 1.5 },
    labelStyle: { fill: "#69736b", fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: "#f8f7f2", fillOpacity: 0.9 },
    labelBgPadding: [5, 3] as [number, number]
  }));
  return { nodes, edges };
}

const GraphCanvas = memo(function GraphCanvas({
  graph,
  storedPositions,
  onNodeSelect,
  onEdgeSelect,
  onClearSelection,
  onLayoutSaved
}: {
  graph?: GraphPayload;
  storedPositions: Record<string, { x: number; y: number }>;
  onNodeSelect: (node: FlowNode) => void;
  onEdgeSelect: (edge: FlowEdge) => void;
  onClearSelection: () => void;
  onLayoutSaved: (positions: Record<string, { x: number; y: number }>) => void;
}) {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>(storedPositions);

  useEffect(() => {
    positionsRef.current = storedPositions;
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const next = toFlow(graph, storedPositions);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [graph, storedPositions]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current) as FlowNode[]);
  }, []);
  const onNodeDragStop = useCallback((_event: unknown, node: FlowNode) => {
    const nextPositions = { ...positionsRef.current, [node.id]: node.position };
    positionsRef.current = nextPositions;
    onLayoutSaved(nextPositions);
  }, [onLayoutSaved]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
      onNodesChange={onNodesChange}
      onNodeClick={(_event, node) => onNodeSelect(node as FlowNode)}
      onEdgeClick={(_event, edge) => onEdgeSelect(edge as FlowEdge)}
      onPaneClick={onClearSelection}
      onNodeDragStop={onNodeDragStop}
      nodesConnectable={false}
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
      minZoom={0.15}
      maxZoom={2}
      defaultEdgeOptions={{ interactionWidth: 16 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9d7cf" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap position="bottom-right" nodeColor={(node) => node.data?.type === "Domain" ? "#b97960" : "#7d9580"} maskColor="rgba(244, 241, 234, 0.76)" />
    </ReactFlow>
  );
});

function App() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("commerce");
  const [mode, setMode] = useState<GraphMode>("system");
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | undefined>();
  const [activeDomain, setActiveDomain] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedKind, setSelectedKind] = useState<"node" | "edge">("node");
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [storedPositions, setStoredPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [lastRunMessage, setLastRunMessage] = useState<string>();
  const deferredSearch = useDeferredValue(search);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: getProjects });
  const project: ProjectSummary | undefined = projectsQuery.data?.projects.find((item) => item.id === projectId);
  const graphQuery = useQuery({
    queryKey: ["graph", projectId, mode, activeType, activeDomain, deferredSearch],
    queryFn: () => getGraph(projectId, mode, { type: activeType, domain: activeDomain, search: deferredSearch.length > 1 ? deferredSearch : undefined }),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous
  });
  const selectedEntityQuery = useQuery({
    queryKey: ["entity", projectId, selectedId],
    queryFn: () => getEntity(projectId, selectedId!),
    enabled: Boolean(selectedId && selectedKind === "node" && mode === "system")
  });
  const selectedRelationshipQuery = useQuery({
    queryKey: ["relationship", projectId, selectedId],
    queryFn: () => getRelationship(projectId, selectedId!),
    enabled: Boolean(selectedId && selectedKind === "edge" && mode === "system")
  });
  const ingestMutation = useMutation({
    mutationFn: () => rerunIngestion(projectId),
    onSuccess: (run) => {
      setLastRunMessage(run.status === "completed" ? `Discovery refreshed · ${run.factCount} facts` : "Discovery failed");
      queryClient.invalidateQueries({ queryKey: ["graph", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const graph = graphQuery.data;
  const selectedGraphEntity = graph?.entities.find((entity) => entity.id === selectedId);
  const selectedGraphEdge = graph?.relationships.find((edge) => edge.id === selectedId);
  const evidence = selectedKind === "edge" ? selectedRelationshipQuery.data?.evidence : selectedEntityQuery.data?.evidence;

  useEffect(() => {
    setSelectedId(undefined);
    setStoredPositions({});
  }, [mode, activeType, activeDomain]);

  const onNodeClick = useCallback((node: FlowNode) => {
    setSelectedKind("node");
    setSelectedId(node.id);
  }, []);
  const onEdgeClick = useCallback((edge: FlowEdge) => {
    setSelectedKind("edge");
    setSelectedId(edge.id);
  }, []);
  const onLayoutSaved = useCallback((positions: Record<string, { x: number; y: number }>) => {
    setStoredPositions(positions);
    void saveLayout(projectId, { projectId, mode, positions, collapsedDomains: [], updatedAt: new Date().toISOString() });
  }, [mode, projectId]);

  const selectType = (type?: string) => {
    setActiveType(type);
    setActiveDomain(undefined);
  };
  const clearFilters = () => { setActiveType(undefined); setActiveDomain(undefined); setSearch(""); };

  return (
    <div className="app-shell">
      <TopBar
        project={project}
        projects={projectsQuery.data?.projects ?? []}
        projectId={projectId}
        setProjectId={setProjectId}
        search={search}
        setSearch={setSearch}
        mode={mode}
        setMode={setMode}
        showLeft={showLeft}
        showRight={showRight}
        setShowLeft={setShowLeft}
        setShowRight={setShowRight}
      />
      <div className="workspace">
        {showLeft && <Explorer
          graph={graph}
          activeType={activeType}
          activeDomain={activeDomain}
          selectType={selectType}
          setActiveDomain={(domain) => { setActiveDomain(domain); setActiveType(undefined); }}
          clearFilters={clearFilters}
          mode={mode}
        />}
        <main className="canvas-region">
          <div className="canvas-toolbar">
            <div className="canvas-context"><span className="context-dot" />{mode === "system" ? "System graph" : "Ontology schema"}<span className="toolbar-separator" />{graph?.totalEntities ?? 0} nodes · {graph?.totalRelationships ?? 0} relations</div>
            <div className="canvas-actions">
              {(activeType || activeDomain || search) && <button className="filter-chip" onClick={clearFilters}><Filter size={13} /> Filters on <X size={12} /></button>}
              <button className="icon-button" title="Center graph" onClick={() => window.dispatchEvent(new Event("onto-fit-view"))}><LocateFixed size={16} /></button>
              <button className="icon-button" title="Canvas settings"><Settings2 size={16} /></button>
            </div>
          </div>
          <div className="graph-frame">
            {graphQuery.isLoading && <div className="graph-loading"><div className="loading-spinner" />Building evidence graph…</div>}
            {graphQuery.error && <div className="graph-error"><X size={18} />Unable to load the graph. Is the local API running?</div>}
            <GraphCanvas
              graph={graph}
              storedPositions={storedPositions}
              onNodeSelect={onNodeClick}
              onEdgeSelect={onEdgeClick}
              onClearSelection={() => setSelectedId(undefined)}
              onLayoutSaved={onLayoutSaved}
            />
            {graph && graph.truncated && <div className="graph-notice"><Network size={14} /> Showing a bounded neighborhood · refine your focus to explore more</div>}
            <div className="canvas-legend">
              <span><i className="legend-line deterministic" /> deterministic</span>
              <span><i className="legend-line configured" /> configuration</span>
              <span><i className="legend-dot weak" /> weak evidence</span>
            </div>
          </div>
          <div className="status-bar">
            <div className="status-left"><span className="status-live"><span /> Live local snapshot</span><span className="status-divider" />revision demo-revision-2026-08-22<span className="status-divider" />{lastRunMessage ?? "All assertions have provenance"}</div>
            <button className="refresh-button" onClick={() => ingestMutation.mutate()} disabled={ingestMutation.isPending}><RefreshCw size={13} className={ingestMutation.isPending ? "spin" : ""} />{ingestMutation.isPending ? "Refreshing…" : "Re-run discovery"}</button>
          </div>
        </main>
        {showRight && <Inspector
          mode={mode}
          entity={selectedGraphEntity}
          relationship={selectedGraphEdge}
          evidence={evidence}
          entities={graph?.entities ?? []}
          relationships={graph?.relationships ?? []}
          onClose={() => setSelectedId(undefined)}
        />}
      </div>
    </div>
  );
}

function TopBar(props: {
  project?: ProjectSummary;
  projects: ProjectSummary[];
  projectId: string;
  setProjectId: (id: string) => void;
  search: string;
  setSearch: (value: string) => void;
  mode: GraphMode;
  setMode: (mode: GraphMode) => void;
  showLeft: boolean;
  showRight: boolean;
  setShowLeft: (show: boolean) => void;
  setShowRight: (show: boolean) => void;
}) {
  return (
    <header className="topbar">
      <div className="brand"><div className="brand-mark">o</div><span>onto</span><span className="brand-slash">/</span><span className="brand-section">explore</span></div>
      <div className="topbar-divider" />
      <button className="project-select"><span className="project-avatar">CS</span><span className="project-copy"><strong>{props.project?.name ?? "Commerce & Sourcing"}</strong><small>workspace snapshot</small></span><ChevronDown size={14} /></button>
      <div className="command-wrap"><Search size={16} /><input aria-label="Search or ask your system" value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Search entities, services, or ask your architecture…" /><span className="shortcut">⌘ K</span></div>
      <div className="topbar-spacer" />
      <div className="mode-toggle" role="tablist" aria-label="Graph mode">
        <button className={props.mode === "system" ? "active" : ""} onClick={() => props.setMode("system")}><Network size={14} />System</button>
        <button className={props.mode === "ontology" ? "active" : ""} onClick={() => props.setMode("ontology")}><GitBranch size={14} />Ontology</button>
      </div>
      <div className="topbar-divider small" />
      <div className="connection-status"><span />Local</div>
      <button className="icon-button topbar-icon" onClick={() => props.setShowLeft(!props.showLeft)} title="Toggle explorer"><PanelLeftClose size={16} /></button>
      <button className="icon-button topbar-icon" onClick={() => props.setShowRight(!props.showRight)} title="Toggle inspector"><PanelRightClose size={16} /></button>
    </header>
  );
}

function Explorer(props: {
  graph?: GraphPayload;
  activeType?: string;
  activeDomain?: string;
  selectType: (type?: string) => void;
  setActiveDomain: (domain: string) => void;
  clearFilters: () => void;
  mode: GraphMode;
}) {
  const entities = props.graph?.entities ?? [];
  const domains = [...new Set(entities.filter((entity) => entity.type === "Domain").map((entity) => entity.name))];
  const counts = (type: string) => entities.filter((entity) => entity.type === type).length;
  const navItem = (label: string, icon: React.ReactNode, type?: string, count?: number) => (
    <button className={`explorer-item ${props.activeType === type ? "active" : ""}`} onClick={() => props.selectType(type)}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}</button>
  );
  return (
    <aside className="explorer">
      <div className="explorer-head"><span>Explorer</span><button className="quiet-button"><Settings2 size={14} /></button></div>
      <div className="explorer-scroll">
        <div className="explorer-label">Model</div>
        {navItem("Everything", <CircleDot size={15} />, undefined, props.graph?.totalEntities)}
        {navItem("Domains", <Layers3 size={15} />, "Domain", counts("Domain"))}
        {navItem("Services", <ServerCog size={15} />, "Service", counts("Service"))}
        {navItem("APIs", <ArrowUpRight size={15} />, "APIEndpoint", counts("APIEndpoint"))}
        {navItem("Events", <Activity size={15} />, "Event", counts("Event"))}
        {navItem("Data stores", <Database size={15} />, "Database", counts("Database"))}
        {navItem("Business concepts", <Boxes size={15} />, "DomainEntity", counts("DomainEntity"))}
        <div className="explorer-label domains-label">Domains</div>
        <div className="domain-list">
          {domains.map((domain, index) => <button key={domain} className={`domain-item ${props.activeDomain === domain ? "active" : ""}`} onClick={() => props.setActiveDomain(domain)}><span className="domain-swatch" style={{ background: domainPalette[index % domainPalette.length] }} />{domain}<em>{entities.filter((entity) => entity.domain === domain && entity.type !== "Domain").length}</em></button>)}
        </div>
        <div className="explorer-label review-label">Review</div>
        <button className="explorer-item review-item"><Sparkles size={15} /><span>Discoveries</span><em className="review-count">0</em></button>
        <button className="explorer-item"><MessageSquareText size={15} /><span>Architecture notes</span></button>
        <div className="explorer-label view-label">View</div>
        <div className="view-card"><div className="view-card-title"><span className="view-status" />{props.mode === "system" ? "System snapshot" : "Ontology v1"}<Check size={13} /></div><p>Evidence-backed local model</p><button onClick={props.clearFilters}>Reset filters <ArrowUpRight size={12} /></button></div>
      </div>
      <div className="explorer-foot"><div className="user-avatar">MB</div><div><strong>Local workspace</strong><small>single-user mode</small></div><ChevronDown size={14} /></div>
    </aside>
  );
}

function Inspector(props: {
  mode: GraphMode;
  entity?: GraphEntity;
  relationship?: GraphRelationship;
  evidence?: EvidenceRef[];
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  onClose: () => void;
}) {
  if (!props.entity && !props.relationship) {
    return <aside className="inspector empty-inspector"><div className="inspector-head"><span>Inspector</span><button className="quiet-button"><PanelRightClose size={14} /></button></div><div className="inspector-empty"><div className="empty-glyph"><LocateFixed size={21} /></div><h3>Nothing selected</h3><p>Select a node or relationship to inspect its definition, confidence, and supporting evidence.</p><div className="tip-row"><span>Tip</span><kbd>⌘</kbd><span>click a node to focus</span></div></div></aside>;
  }
  if (props.relationship) {
    const relationship = props.relationship;
    const source = props.entities.find((entity) => entity.id === relationship.source);
    const target = props.entities.find((entity) => entity.id === relationship.target);
    return <aside className="inspector"><InspectorHeader title="Relationship" onClose={props.onClose} /><div className="relation-hero"><div className="relation-end"><span className="relation-icon">{typeIcon(source?.type ?? "")}</span><strong>{source?.name ?? "Unknown"}</strong><small>{typeLabel(source?.type ?? "")}</small></div><ArrowLeftRight size={16} className="relation-arrow" /><div className="relation-end target"><span className="relation-icon">{typeIcon(target?.type ?? "")}</span><strong>{target?.name ?? "Unknown"}</strong><small>{typeLabel(target?.type ?? "")}</small></div></div><div className="relation-type-pill">{relationship.type}</div><ConfidenceMeter confidence={relationship.confidence} origin={relationship.origin} /><EvidenceSection evidence={props.evidence} /></aside>;
  }
  const entity = props.entity!;
  const outgoing = props.relationships.filter((edge) => edge.source === entity.id);
  const incoming = props.relationships.filter((edge) => edge.target === entity.id);
  return <aside className="inspector"><InspectorHeader title="Entity inspector" onClose={props.onClose} /><div className="entity-hero"><div className={`entity-hero-icon type-${entity.type.toLowerCase()}`}>{typeIcon(entity.type)}</div><div><div className="eyebrow">{typeLabel(entity.type)}</div><h2>{entity.name}</h2><div className="entity-id">{entity.id}</div></div></div>{entity.description && <p className="definition">{entity.description}</p>}<ConfidenceMeter confidence={entity.confidence} origin={entity.origin} /><div className="inspector-section"><div className="section-heading">Ownership & scope</div><div className="detail-grid">{entity.owner && <div><span>Owner</span><strong><Users size={13} />{entity.owner}</strong></div>}{entity.domain && <div><span>Domain</span><strong><Layers3 size={13} />{entity.domain}</strong></div>}</div></div><div className="inspector-section"><div className="section-heading">Relationships <em>{outgoing.length + incoming.length}</em></div><div className="relationship-list">{outgoing.slice(0, 8).map((edge) => <button key={`out-${edge.id}`} onClick={() => undefined}><span className="direction out">→</span><span>{edge.type}</span><strong>{props.entities.find((item) => item.id === edge.target)?.name}</strong></button>)}{incoming.slice(0, 8).map((edge) => <button key={`in-${edge.id}`} onClick={() => undefined}><span className="direction in">←</span><span>{edge.type}</span><strong>{props.entities.find((item) => item.id === edge.source)?.name}</strong></button>)}{outgoing.length + incoming.length === 0 && <div className="muted-note">No visible relationships in this focus.</div>}</div></div><EvidenceSection evidence={props.evidence} /></aside>;
}

function InspectorHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="inspector-head"><span>{title}</span><div className="inspector-head-actions"><button className="quiet-button"><Code2 size={14} /></button><button className="quiet-button" onClick={onClose}><X size={15} /></button></div></div>;
}

function ConfidenceMeter({ confidence, origin }: { confidence: number; origin: string }) {
  const percentage = Math.round(confidence * 100);
  return <div className="confidence-block"><div className="confidence-top"><span>Confidence</span><strong>{percentage}%</strong></div><div className="confidence-track"><span style={{ width: `${percentage}%` }} /></div><div className="confidence-bottom"><span className={`origin-dot origin-${origin}`} />{origin === "configuration" ? "configuration evidence" : `${origin} evidence`}<span className="confidence-label">{percentage >= 90 ? "strong" : percentage >= 75 ? "moderate" : "weak"}</span></div></div>;
}

function EvidenceSection({ evidence }: { evidence?: EvidenceRef[] }) {
  return <div className="inspector-section evidence-section"><div className="section-heading">Evidence <em>{evidence?.length ?? 0}</em></div>{evidence?.length ? <div className="evidence-list">{evidence.map((item) => <div className="evidence-item" key={item.id}><div className="evidence-icon"><FileCode2 size={13} /></div><div className="evidence-copy"><strong>{item.label}</strong><span>{item.location?.file ?? item.uri ?? "Source reference"}{item.location?.line ? `:${item.location.line}` : ""}</span><small>{item.kind}</small></div><ArrowUpRight size={13} className="evidence-arrow" /></div>)}</div> : <div className="empty-evidence"><FileCode2 size={15} /><span>No source evidence attached.</span></div>}</div>;
}

export { App };
