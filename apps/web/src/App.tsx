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
  if (type === "FrontendApplication") return <Network size={15} />;
  if (type === "FrontendRoute") return <ArrowUpRight size={15} />;
  if (type === "Workflow") return <GitBranch size={15} />;
  if (type === "FrontendApiCall") return <Code2 size={15} />;
  if (type === "BffEndpoint") return <ServerCog size={15} />;
  if (type === "ApplicationService") return <Settings2 size={15} />;
  if (type === "DownstreamOperation") return <ArrowLeftRight size={15} />;
  if (type === "Configuration") return <Settings2 size={15} />;
  if (type === "AuthPolicy") return <Check size={15} />;
  if (type === "APIEndpoint") return <ArrowUpRight size={15} />;
  if (type === "Event") return <Activity size={15} />;
  if (type === "Database") return <Database size={15} />;
  if (type === "DomainEntity") return <Boxes size={15} />;
  if (type === "Schema") return <FileCode2 size={15} />;
  if (type === "Domain") return <Layers3 size={15} />;
  return <CircleDot size={15} />;
};

const typeLabel = (type: string) => ({ APIEndpoint: "API endpoint", BffEndpoint: "BFF endpoint", FrontendApiCall: "frontend API call", FrontendApplication: "frontend application", FrontendRoute: "frontend route", ApplicationService: "application service", DownstreamOperation: "downstream operation", AuthPolicy: "authorization policy", DomainEntity: "Domain entity", OntologyType: "Ontology type" }[type] ?? type);

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
  const domainIndex = new Map<string, number>(domains.map((domain, index): [string, number] => [domain.name, index]));
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
  const [projectId, setProjectId] = useState("offer-sample-management");
  const [mode, setMode] = useState<GraphMode>("system");
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | undefined>();
  const [activeDomain, setActiveDomain] = useState<string | undefined>();
  const [activeWorkflow, setActiveWorkflow] = useState<string | undefined>();
  const [activeRoute, setActiveRoute] = useState<string | undefined>();
  const [activeEndpoint, setActiveEndpoint] = useState<string | undefined>();
  const [activeDownstream, setActiveDownstream] = useState<string | undefined>();
  const [activeRepository, setActiveRepository] = useState<string | undefined>();
  const [activeEnvironment, setActiveEnvironment] = useState<string | undefined>();
  const [activeOrigin, setActiveOrigin] = useState<string | undefined>();
  const [minimumConfidence, setMinimumConfidence] = useState<number | undefined>();
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
    queryKey: ["graph", projectId, mode, activeType, activeDomain, activeWorkflow, activeRoute, activeEndpoint, activeDownstream, activeRepository, activeEnvironment, activeOrigin, minimumConfidence, deferredSearch],
    queryFn: () => getGraph(projectId, mode, {
      type: activeType,
      domain: activeDomain,
      workflow: activeWorkflow,
      route: activeRoute,
      endpoint: activeEndpoint,
      downstream: activeDownstream,
      repository: activeRepository,
      environment: activeEnvironment,
      origin: activeOrigin,
      confidence: minimumConfidence,
      search: deferredSearch.length > 1 ? deferredSearch : undefined
    }),
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
  }, [mode, activeType, activeDomain, activeWorkflow, activeRoute, activeEndpoint, activeDownstream, activeRepository, activeEnvironment, activeOrigin, minimumConfidence]);

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
  const clearFilters = () => {
    setActiveType(undefined);
    setActiveDomain(undefined);
    setActiveWorkflow(undefined);
    setActiveRoute(undefined);
    setActiveEndpoint(undefined);
    setActiveDownstream(undefined);
    setActiveRepository(undefined);
    setActiveEnvironment(undefined);
    setActiveOrigin(undefined);
    setMinimumConfidence(undefined);
    setSearch("");
  };

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
          activeWorkflow={activeWorkflow}
          selectType={selectType}
          setActiveDomain={(domain) => { setActiveDomain(domain); setActiveType(undefined); }}
          setActiveWorkflow={(workflow) => { setActiveWorkflow(workflow); setActiveType(undefined); setActiveDomain(undefined); }}
          clearFilters={clearFilters}
          mode={mode}
        />}
        <main className="canvas-region">
          <div className="canvas-toolbar">
            <div className="canvas-context"><span className="context-dot" />{mode === "system" ? "System graph" : "Ontology schema"}<span className="toolbar-separator" />{graph?.totalEntities ?? 0} nodes · {graph?.totalRelationships ?? 0} relations</div>
            {mode === "system" && <GraphFiltersBar
              graph={graph}
              workflow={activeWorkflow}
              route={activeRoute}
              endpoint={activeEndpoint}
              downstream={activeDownstream}
              repository={activeRepository}
              environment={activeEnvironment}
              origin={activeOrigin}
              confidence={minimumConfidence}
              setWorkflow={setActiveWorkflow}
              setRoute={setActiveRoute}
              setEndpoint={setActiveEndpoint}
              setDownstream={setActiveDownstream}
              setRepository={setActiveRepository}
              setEnvironment={setActiveEnvironment}
              setOrigin={setActiveOrigin}
              setConfidence={setMinimumConfidence}
            />}
            <div className="canvas-actions">
              {(activeType || activeDomain || activeWorkflow || activeRoute || activeEndpoint || activeDownstream || activeRepository || activeEnvironment || activeOrigin || minimumConfidence || search) && <button className="filter-chip" onClick={clearFilters}><Filter size={13} /> Filters on <X size={12} /></button>}
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
            <div className="status-left"><span className="status-live"><span /> Live local snapshot</span><span className="status-divider" />{project?.id ?? "workspace"}<span className="status-divider" />{lastRunMessage ?? "All assertions have provenance"}</div>
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

function GraphFiltersBar(props: {
  graph?: GraphPayload;
  workflow?: string;
  route?: string;
  endpoint?: string;
  downstream?: string;
  repository?: string;
  environment?: string;
  origin?: string;
  confidence?: number;
  setWorkflow: (value?: string) => void;
  setRoute: (value?: string) => void;
  setEndpoint: (value?: string) => void;
  setDownstream: (value?: string) => void;
  setRepository: (value?: string) => void;
  setEnvironment: (value?: string) => void;
  setOrigin: (value?: string) => void;
  setConfidence: (value?: number) => void;
}) {
  const entities = props.graph?.entities ?? [];
  const workflows: Array<[string, string]> = [...new Map<string, string>(entities.filter((entity) => entity.type === "Workflow").map((entity): [string, string] => [String(entity.properties.workflowKey ?? entity.name), entity.name])).entries()];
  const routes = [...new Set(entities.filter((entity) => entity.type === "FrontendRoute").map((entity) => entity.name))] as string[];
  const endpoints = [...new Set(entities.filter((entity) => entity.type === "BffEndpoint").map((entity) => entity.name))] as string[];
  const downstream = [...new Set(entities.filter((entity) => entity.type === "Service").map((entity) => entity.name))] as string[];
  const repositories = [...new Set(entities.flatMap((entity) => [entity.source?.repository, typeof entity.properties.repository === "string" ? entity.properties.repository : undefined]).filter(Boolean))] as string[];
  const environments = [...new Set(entities.map((entity) => entity.source?.environment ?? (typeof entity.properties.environment === "string" ? entity.properties.environment : undefined)).filter(Boolean))] as string[];
  return <div className="graph-filters" aria-label="Evidence graph filters">
    <select aria-label="Workflow filter" value={props.workflow ?? ""} onChange={(event) => props.setWorkflow(event.target.value || undefined)}>
      <option value="">All workflows</option>
      {workflows.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <select aria-label="Frontend route filter" value={props.route ?? ""} onChange={(event) => props.setRoute(event.target.value || undefined)}>
      <option value="">All routes</option>
      {routes.map((route) => <option key={route} value={route}>{route}</option>)}
    </select>
    <select aria-label="BFF endpoint filter" value={props.endpoint ?? ""} onChange={(event) => props.setEndpoint(event.target.value || undefined)}>
      <option value="">All BFF endpoints</option>
      {endpoints.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
    </select>
    <select aria-label="Downstream service filter" value={props.downstream ?? ""} onChange={(event) => props.setDownstream(event.target.value || undefined)}>
      <option value="">All downstream services</option>
      {downstream.map((service) => <option key={service} value={service}>{service}</option>)}
    </select>
    <select aria-label="Repository filter" value={props.repository ?? ""} onChange={(event) => props.setRepository(event.target.value || undefined)}>
      <option value="">All repositories</option>
      {repositories.map((repository) => <option key={repository} value={repository}>{repository}</option>)}
    </select>
    <select aria-label="Environment filter" value={props.environment ?? ""} onChange={(event) => props.setEnvironment(event.target.value || undefined)}>
      <option value="">All environments</option>
      {environments.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
    </select>
    <select aria-label="Evidence origin filter" value={props.origin ?? ""} onChange={(event) => props.setOrigin(event.target.value || undefined)}>
      <option value="">All evidence</option>
      <option value="deterministic">Deterministic</option>
      <option value="configuration">Configuration</option>
      <option value="documentation">Documentation</option>
    </select>
    <select aria-label="Minimum confidence filter" value={props.confidence ?? ""} onChange={(event) => props.setConfidence(event.target.value ? Number(event.target.value) : undefined)}>
      <option value="">Any confidence</option>
      <option value="0.8">≥ 80%</option>
      <option value="0.9">≥ 90%</option>
      <option value="0.95">≥ 95%</option>
    </select>
  </div>;
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
      <label className="project-select"><span className="project-avatar">{props.projectId === "offer-sample-management" ? "OS" : "CS"}</span><span className="project-copy"><strong>{props.project?.name ?? "Commerce & Sourcing"}</strong><small>workspace snapshot</small></span><select aria-label="Project snapshot" value={props.projectId} onChange={(event) => props.setProjectId(event.target.value)}>{props.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label>
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
  activeWorkflow?: string;
  selectType: (type?: string) => void;
  setActiveDomain: (domain: string) => void;
  setActiveWorkflow: (workflow?: string) => void;
  clearFilters: () => void;
  mode: GraphMode;
}) {
  const entities = props.graph?.entities ?? [];
  const domains: string[] = [...new Set<string>(entities.filter((entity) => entity.type === "Domain").map((entity): string => entity.name))];
  const workflows: Array<[string, string]> = [...new Map<string, string>(entities.filter((entity) => entity.type === "Workflow").map((entity): [string, string] => [String(entity.properties.workflowKey ?? entity.name), entity.name])).entries()];
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
        {navItem("Frontend calls", <Code2 size={15} />, "FrontendApiCall", counts("FrontendApiCall"))}
        {navItem("BFF endpoints", <ServerCog size={15} />, "BffEndpoint", counts("BffEndpoint"))}
        {navItem("Events", <Activity size={15} />, "Event", counts("Event"))}
        {navItem("Data stores", <Database size={15} />, "Database", counts("Database"))}
        {navItem("Business concepts", <Boxes size={15} />, "DomainEntity", counts("DomainEntity"))}
        <div className="explorer-label domains-label">Workflows</div>
        <div className="domain-list">
          {workflows.map(([value, label]) => <button key={value} className={`domain-item ${props.activeWorkflow === value ? "active" : ""}`} onClick={() => props.setActiveWorkflow(props.activeWorkflow === value ? undefined : value)}><span className="domain-swatch workflow-swatch" />{label}<em>{entities.filter((entity) => String(entity.properties.workflow ?? entity.properties.workflowKey ?? "") === value).length}</em></button>)}
        </div>
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
  return <div className="inspector-section evidence-section"><div className="section-heading">Evidence <em>{evidence?.length ?? 0}</em></div>{evidence?.length ? <div className="evidence-list">{evidence.map((item) => <div className="evidence-item" key={item.id}><div className="evidence-icon"><FileCode2 size={13} /></div><div className="evidence-copy"><strong>{item.label}</strong><span>{item.location?.file ?? item.uri ?? "Source reference"}{item.location?.line ? `:${item.location.line}` : ""}</span>{(item.repository || item.revision || item.environment) && <small className="evidence-source">{item.repository ?? "source"}{item.revision ? ` · ${item.revision}` : ""}{item.environment ? ` · ${item.environment}` : ""}</small>}<small>{item.kind}</small></div><ArrowUpRight size={13} className="evidence-arrow" /></div>)}</div> : <div className="empty-evidence"><FileCode2 size={15} /><span>No source evidence attached.</span></div>}</div>;
}

export { App };
