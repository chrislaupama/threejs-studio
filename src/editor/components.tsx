import {
  AlertTriangle,
  Box,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Cylinder,
  Eye,
  EyeOff,
  FileBox,
  Folder,
  Grid3X3,
  Info,
  Lightbulb,
  LockKeyhole,
  MoreHorizontal,
  Package,
  Palette,
  Plus,
  Search,
  Terminal,
  Trash2,
  Triangle,
  UnlockKeyhole,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ConsoleEntry,
  PrimitiveType,
  ProjectDocument,
  SceneNode,
  StudioAsset,
} from './types';

const iconSize = 14;

export interface IconButtonProps {
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onClick?: () => void;
  testId?: string;
  className?: string;
}

export function IconButton({
  label,
  children,
  active = false,
  disabled = false,
  compact = false,
  onClick,
  testId,
  className = '',
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'is-active' : ''} ${compact ? 'is-compact' : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

function NodeGlyph({ node }: { node: SceneNode }) {
  if (node.kind === 'camera') return <Camera size={iconSize} />;
  if (node.kind === 'light') return <Lightbulb size={iconSize} />;
  if (node.kind === 'group') return <Folder size={iconSize} />;
  if (node.primitive === 'sphere') return <Circle size={iconSize} />;
  if (node.primitive === 'cylinder' || node.primitive === 'capsule') return <Cylinder size={iconSize} />;
  if (node.primitive === 'cone') return <Triangle size={iconSize} />;
  if (node.primitive === 'torus') return <Circle size={iconSize} className="ring-glyph" />;
  return <Box size={iconSize} />;
}

interface HierarchyProps {
  project: ProjectDocument;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onAdd: () => void;
}

interface TreeRowProps extends Omit<HierarchyProps, 'project' | 'onAdd'> {
  node: SceneNode;
  depth: number;
  childrenByParent: Map<string | null, SceneNode[]>;
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
}

function TreeRow({
  node,
  depth,
  childrenByParent,
  collapsed,
  selectedId,
  disabled,
  onSelect,
  onRename,
  onToggleVisible,
  onToggleLock,
  onToggleCollapsed,
}: TreeRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(node.name);
  const children = childrenByParent.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(node.id);

  useEffect(() => setDraftName(node.name), [node.name]);

  const finishRename = () => {
    const cleanName = draftName.trim();
    if (cleanName && cleanName !== node.name) onRename(node.id, cleanName);
    else setDraftName(node.name);
    setRenaming(false);
  };

  return (
    <>
      <div
        className={`tree-row ${selectedId === node.id ? 'is-selected' : ''} ${!node.visible ? 'is-hidden' : ''}`}
        style={{ '--tree-depth': depth } as React.CSSProperties}
        role="treeitem"
        aria-selected={selectedId === node.id}
        tabIndex={selectedId === node.id ? 0 : -1}
        onClick={() => !disabled && onSelect(node.id)}
        onDoubleClick={() => !disabled && node.id !== 'scene-root' && setRenaming(true)}
        data-node-id={node.id}
      >
        <button
          type="button"
          className="tree-disclosure"
          aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          disabled={!hasChildren}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleCollapsed(node.id);
          }}
        >
          {hasChildren ? isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : null}
        </button>
        <span className={`node-glyph node-glyph-${node.kind}`}><NodeGlyph node={node} /></span>
        {renaming ? (
          <input
            className="tree-rename"
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setDraftName(node.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="tree-name">{node.name}</span>
        )}
        <span className="tree-row-actions">
          <button
            type="button"
            className="tree-mini-action"
            aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleVisible(node.id);
            }}
          >
            {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            type="button"
            className="tree-mini-action"
            aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleLock(node.id);
            }}
          >
            {node.locked ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}
          </button>
        </span>
      </div>
      {!isCollapsed && children.map((child) => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          childrenByParent={childrenByParent}
          collapsed={collapsed}
          selectedId={selectedId}
          disabled={disabled}
          onSelect={onSelect}
          onRename={onRename}
          onToggleVisible={onToggleVisible}
          onToggleLock={onToggleLock}
          onToggleCollapsed={onToggleCollapsed}
        />
      ))}
    </>
  );
}

export function HierarchyPanel({
  project,
  selectedId,
  disabled,
  onSelect,
  onRename,
  onToggleVisible,
  onToggleLock,
  onAdd,
}: HierarchyProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, SceneNode[]>();
    for (const node of project.nodes) {
      const siblings = map.get(node.parentId) ?? [];
      siblings.push(node);
      map.set(node.parentId, siblings);
    }
    return map;
  }, [project.nodes]);
  const roots = childrenByParent.get(null) ?? [];
  const matches = query.trim()
    ? project.nodes.filter((node) => node.name.toLowerCase().includes(query.trim().toLowerCase()))
    : null;

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="dock hierarchy-panel" aria-label="Scene hierarchy" data-testid="hierarchy-panel">
      <div className="dock-header">
        <div>
          <span className="dock-eyebrow">Scene</span>
          <strong>Hierarchy</strong>
        </div>
        <div className="dock-header-actions">
          <IconButton label="Add object" compact onClick={onAdd} disabled={disabled}><Plus size={14} /></IconButton>
          <IconButton label="Hierarchy options" compact><MoreHorizontal size={14} /></IconButton>
        </div>
      </div>
      <label className="panel-search">
        <Search size={13} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scene" />
        {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={12} /></button> : null}
      </label>
      <div className="tree" role="tree" aria-label="Scene objects">
        {matches ? matches.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            childrenByParent={new Map()}
            collapsed={collapsed}
            selectedId={selectedId}
            disabled={disabled}
            onSelect={onSelect}
            onRename={onRename}
            onToggleVisible={onToggleVisible}
            onToggleLock={onToggleLock}
            onToggleCollapsed={toggleCollapsed}
          />
        )) : roots.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            childrenByParent={childrenByParent}
            collapsed={collapsed}
            selectedId={selectedId}
            disabled={disabled}
            onSelect={onSelect}
            onRename={onRename}
            onToggleVisible={onToggleVisible}
            onToggleLock={onToggleLock}
            onToggleCollapsed={toggleCollapsed}
          />
        ))}
      </div>
      <div className="dock-footer">
        <span>{project.nodes.length} objects</span>
        <span>1 scene</span>
      </div>
    </aside>
  );
}

interface NumberFieldProps {
  value: number;
  label: string;
  accent?: 'x' | 'y' | 'z';
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

function NumberField({ value, label, accent, step = 0.1, disabled, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(String(Number(value.toFixed(3))));
  };

  return (
    <label className="number-field">
      <span className={accent ? `axis-label axis-${accent}` : ''}>{label}</span>
      <input
        type="number"
        value={draft}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(Number(value.toFixed(3))));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface VectorEditorProps {
  label: string;
  values: [number, number, number];
  degrees?: boolean;
  disabled?: boolean;
  onChange: (values: [number, number, number]) => void;
}

function VectorEditor({ label, values, degrees = false, disabled, onChange }: VectorEditorProps) {
  const display = degrees
    ? values.map((value) => value * (180 / Math.PI)) as [number, number, number]
    : values;
  const commit = (index: number, value: number) => {
    const next = [...display] as [number, number, number];
    next[index] = value;
    onChange(degrees ? next.map((entry) => entry * (Math.PI / 180)) as [number, number, number] : next);
  };
  return (
    <div className="vector-row">
      <span className="property-label">{label}</span>
      <div className="vector-fields">
        <NumberField label="X" accent="x" value={display[0]} disabled={disabled} onCommit={(value) => commit(0, value)} />
        <NumberField label="Y" accent="y" value={display[1]} disabled={disabled} onCommit={(value) => commit(1, value)} />
        <NumberField label="Z" accent="z" value={display[2]} disabled={disabled} onCommit={(value) => commit(2, value)} />
      </div>
    </div>
  );
}

interface InspectorProps {
  node: SceneNode | undefined;
  disabled: boolean;
  project: ProjectDocument;
  onUpdate: (node: SceneNode, label: string) => void;
  onDelete: () => void;
}

function ComponentHeading({ icon, title, onRemove }: { icon: ReactNode; title: string; onRemove?: () => void }) {
  return (
    <div className="component-heading">
      <span>{icon}</span>
      <strong>{title}</strong>
      <button type="button" aria-label={`${title} options`}><MoreHorizontal size={13} /></button>
      {onRemove ? <button type="button" aria-label={`Remove ${title}`} onClick={onRemove}><Trash2 size={12} /></button> : null}
    </div>
  );
}

export function InspectorPanel({ node, disabled, project, onUpdate, onDelete }: InspectorProps) {
  const [componentMenuOpen, setComponentMenuOpen] = useState(false);
  if (!node) {
    return (
      <aside className="dock inspector-panel" aria-label="Inspector" data-testid="inspector-panel">
        <div className="dock-header"><div><span className="dock-eyebrow">Properties</span><strong>Inspector</strong></div></div>
        <div className="inspector-empty">
          <div className="empty-orbit"><Circle size={30} /><span /></div>
          <strong>Nothing selected</strong>
          <p>Select an object in the scene or hierarchy to inspect its components.</p>
        </div>
      </aside>
    );
  }

  const updateTransform = (key: keyof SceneNode['transform'], value: [number, number, number]) => {
    onUpdate({ ...node, transform: { ...node.transform, [key]: value } }, `Change ${key}`);
  };

  return (
    <aside className="dock inspector-panel" aria-label="Inspector" data-testid="inspector-panel">
      <div className="dock-header inspector-titlebar">
        <div>
          <span className="dock-eyebrow">Properties</span>
          <strong>Inspector</strong>
        </div>
        <IconButton label="Inspector options" compact><MoreHorizontal size={14} /></IconButton>
      </div>
      <div className="inspector-scroll">
        <div className="object-header">
          <label className="visibility-check" title={node.visible ? 'Object enabled' : 'Object disabled'}>
            <input
              type="checkbox"
              checked={node.visible}
              disabled={disabled || node.id === 'scene-root'}
              onChange={(event) => onUpdate({ ...node, visible: event.target.checked }, 'Toggle object')}
            />
            <span />
          </label>
          <span className={`object-type-icon object-type-${node.kind}`}><NodeGlyph node={node} /></span>
          <input
            className="object-name-input"
            value={node.name}
            disabled={disabled || node.id === 'scene-root'}
            onChange={(event) => onUpdate({ ...node, name: event.target.value }, 'Rename object')}
            data-testid="inspector-name"
          />
          <IconButton label="More object options" compact><MoreHorizontal size={14} /></IconButton>
        </div>
        <div className="object-meta-row">
          <label><span>Tag</span><select disabled={disabled}><option>Untagged</option><option>Player</option><option>Environment</option></select></label>
          <label><span>Layer</span><select disabled={disabled}><option>Default</option><option>UI</option><option>Ignore Raycast</option></select></label>
        </div>

        <details className="component" open>
          <summary><ComponentHeading icon={<Box size={14} />} title="Transform" /></summary>
          <div className="component-body">
            <VectorEditor label="Position" values={node.transform.position} disabled={disabled || node.locked} onChange={(value) => updateTransform('position', value)} />
            <VectorEditor label="Rotation" values={node.transform.rotation} degrees disabled={disabled || node.locked} onChange={(value) => updateTransform('rotation', value)} />
            <VectorEditor label="Scale" values={node.transform.scale} disabled={disabled || node.locked} onChange={(value) => updateTransform('scale', value)} />
          </div>
        </details>

        {node.kind === 'mesh' && node.material ? (
          <details className="component" open>
            <summary><ComponentHeading icon={<Palette size={14} />} title="Mesh Renderer" /></summary>
            <div className="component-body property-stack">
              <div className="material-preview-row">
                <span className="property-label">Material</span>
                <div className="material-slot"><span style={{ background: node.material.color }} /><strong>Standard PBR</strong><MoreHorizontal size={13} /></div>
              </div>
              <label className="property-row color-property">
                <span className="property-label">Base color</span>
                <span className="color-control">
                  <input
                    type="color"
                    value={node.material.color}
                    disabled={disabled}
                    onChange={(event) => onUpdate({ ...node, material: { ...node.material!, color: event.target.value } }, 'Change material color')}
                  />
                  <code>{node.material.color.toUpperCase()}</code>
                </span>
              </label>
              <label className="property-row range-property">
                <span className="property-label">Metallic</span>
                <input type="range" min="0" max="1" step="0.01" value={node.material.metalness} disabled={disabled} onChange={(event) => onUpdate({ ...node, material: { ...node.material!, metalness: Number(event.target.value) } }, 'Change metallic')} />
                <code>{node.material.metalness.toFixed(2)}</code>
              </label>
              <label className="property-row range-property">
                <span className="property-label">Roughness</span>
                <input type="range" min="0" max="1" step="0.01" value={node.material.roughness} disabled={disabled} onChange={(event) => onUpdate({ ...node, material: { ...node.material!, roughness: Number(event.target.value) } }, 'Change roughness')} />
                <code>{node.material.roughness.toFixed(2)}</code>
              </label>
              <div className="property-row checkbox-row">
                <span className="property-label">Lighting</span>
                <label><input type="checkbox" checked={Boolean(node.castShadow)} disabled={disabled} onChange={(event) => onUpdate({ ...node, castShadow: event.target.checked }, 'Toggle cast shadows')} /> Cast shadows</label>
                <label><input type="checkbox" checked={Boolean(node.receiveShadow)} disabled={disabled} onChange={(event) => onUpdate({ ...node, receiveShadow: event.target.checked }, 'Toggle receive shadows')} /> Receive</label>
              </div>
            </div>
          </details>
        ) : null}

        {node.kind === 'light' && node.light ? (
          <details className="component" open>
            <summary><ComponentHeading icon={<Lightbulb size={14} />} title="Light" /></summary>
            <div className="component-body property-stack">
              <label className="property-row"><span className="property-label">Type</span><select value={node.light.type} disabled={disabled} onChange={(event) => onUpdate({ ...node, light: { ...node.light!, type: event.target.value as SceneNode['light'] extends infer _T ? 'directional' | 'point' | 'spot' : never } }, 'Change light type')}><option value="directional">Directional</option><option value="point">Point</option><option value="spot">Spot</option></select></label>
              <label className="property-row color-property"><span className="property-label">Color</span><span className="color-control"><input type="color" value={node.light.color} disabled={disabled} onChange={(event) => onUpdate({ ...node, light: { ...node.light!, color: event.target.value } }, 'Change light color')} /><code>{node.light.color.toUpperCase()}</code></span></label>
              <label className="property-row"><span className="property-label">Intensity</span><NumberField label="" value={node.light.intensity} step={0.1} disabled={disabled} onCommit={(value) => onUpdate({ ...node, light: { ...node.light!, intensity: Math.max(0, value) } }, 'Change light intensity')} /></label>
              <label className="property-row checkbox-row"><span className="property-label">Shadows</span><label><input type="checkbox" checked={node.light.castShadow} disabled={disabled} onChange={(event) => onUpdate({ ...node, light: { ...node.light!, castShadow: event.target.checked } }, 'Toggle light shadows')} /> Enabled</label></label>
            </div>
          </details>
        ) : null}

        {node.kind === 'camera' && node.camera ? (
          <details className="component" open>
            <summary><ComponentHeading icon={<Camera size={14} />} title="Camera" /></summary>
            <div className="component-body property-stack">
              <label className="property-row"><span className="property-label">Field of view</span><NumberField label="°" value={node.camera.fov} step={1} disabled={disabled} onCommit={(value) => onUpdate({ ...node, camera: { ...node.camera!, fov: Math.min(120, Math.max(10, value)) } }, 'Change camera FOV')} /></label>
              <label className="property-row"><span className="property-label">Near clip</span><NumberField label="" value={node.camera.near} step={0.01} disabled={disabled} onCommit={(value) => onUpdate({ ...node, camera: { ...node.camera!, near: Math.max(0.01, value) } }, 'Change near clip')} /></label>
              <label className="property-row"><span className="property-label">Far clip</span><NumberField label="" value={node.camera.far} step={10} disabled={disabled} onCommit={(value) => onUpdate({ ...node, camera: { ...node.camera!, far: Math.max(node.camera!.near + 1, value) } }, 'Change far clip')} /></label>
              <label className="property-row checkbox-row"><span className="property-label">Role</span><label><input type="checkbox" checked={node.camera.primary} disabled={disabled} onChange={(event) => onUpdate({ ...node, camera: { ...node.camera!, primary: event.target.checked } }, 'Set primary camera')} /> Primary camera</label></label>
            </div>
          </details>
        ) : null}

        {node.behavior ? (
          <details className="component" open>
            <summary><ComponentHeading icon={<FileBox size={14} />} title={node.behavior.type === 'rotate' ? 'Rotator Behavior' : 'Float Behavior'} onRemove={() => onUpdate({ ...node, behavior: undefined }, 'Remove behavior')} /></summary>
            <div className="component-body property-stack">
              <label className="property-row checkbox-row"><span className="property-label">Enabled</span><label><input type="checkbox" checked={node.behavior.enabled} disabled={disabled} onChange={(event) => onUpdate({ ...node, behavior: { ...node.behavior!, enabled: event.target.checked } }, 'Toggle behavior')} /> Run in play mode</label></label>
              <label className="property-row"><span className="property-label">Speed</span><NumberField label="x" value={node.behavior.speed} disabled={disabled} onCommit={(value) => onUpdate({ ...node, behavior: { ...node.behavior!, speed: value } }, 'Change behavior speed')} /></label>
              {node.behavior.type === 'float' ? <label className="property-row"><span className="property-label">Amplitude</span><NumberField label="m" value={node.behavior.amplitude} disabled={disabled} onCommit={(value) => onUpdate({ ...node, behavior: { ...node.behavior!, amplitude: Math.max(0, value) } }, 'Change float amplitude')} /></label> : null}
            </div>
          </details>
        ) : null}

        {node.kind === 'mesh' && !node.behavior ? (
          <div className="add-component-wrap">
            <button type="button" className="add-component-button" disabled={disabled} onClick={() => setComponentMenuOpen((open) => !open)}><Plus size={14} /> Add Component</button>
            {componentMenuOpen ? (
              <div className="component-menu">
                <span>Add behavior</span>
                <button type="button" onClick={() => { onUpdate({ ...node, behavior: { type: 'rotate', enabled: true, speed: 1, amplitude: 0 } }, 'Add rotator behavior'); setComponentMenuOpen(false); }}><FileBox size={14} /><span><strong>Rotator</strong><small>Rotate while the game is playing</small></span></button>
                <button type="button" onClick={() => { onUpdate({ ...node, behavior: { type: 'float', enabled: true, speed: 1, amplitude: 0.2 } }, 'Add float behavior'); setComponentMenuOpen(false); }}><FileBox size={14} /><span><strong>Float</strong><small>Animate along the vertical axis</small></span></button>
              </div>
            ) : null}
          </div>
        ) : null}

        {node.id !== 'scene-root' ? <button type="button" className="inspector-delete" disabled={disabled} onClick={onDelete}><Trash2 size={13} /> Remove object</button> : null}
        <div className="inspector-path">{project.sceneName} / {node.name}<code>{node.id}</code></div>
      </div>
    </aside>
  );
}

interface AssetGridProps {
  assets: StudioAsset[];
  selectedNode: SceneNode | undefined;
  onActivate: (asset: StudioAsset) => void;
}

function AssetPreview({ asset }: { asset: StudioAsset }) {
  if (asset.kind === 'material') return <div className="asset-swatch" style={{ background: asset.color }}><span /></div>;
  if (asset.kind === 'scene') return <div className="scene-thumbnail"><Grid3X3 size={28} /><span /><i /></div>;
  return (
    <div className="primitive-thumbnail" style={{ '--asset-color': asset.color } as React.CSSProperties}>
      {asset.primitive === 'sphere' ? <Circle size={36} /> : asset.primitive === 'cylinder' || asset.primitive === 'capsule' ? <Cylinder size={36} /> : asset.primitive === 'cone' ? <Triangle size={36} /> : <Box size={36} />}
    </div>
  );
}

function AssetGrid({ assets, selectedNode, onActivate }: AssetGridProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | StudioAsset['kind']>('all');
  const [selectedAsset, setSelectedAsset] = useState<string | null>('scene-main');
  const visible = assets.filter((asset) =>
    (category === 'all' || asset.kind === category) && asset.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="assets-layout">
      <nav className="asset-folders" aria-label="Asset folders">
        <button type="button" className={category === 'all' ? 'is-active' : ''} onClick={() => setCategory('all')}><Folder size={13} /> Assets <span>{assets.length}</span></button>
        <button type="button" className={category === 'scene' ? 'is-active' : ''} onClick={() => setCategory('scene')}><FileBox size={13} /> Scenes <span>{assets.filter((asset) => asset.kind === 'scene').length}</span></button>
        <button type="button" className={category === 'primitive' ? 'is-active' : ''} onClick={() => setCategory('primitive')}><Package size={13} /> Prefabs <span>{assets.filter((asset) => asset.kind === 'primitive').length}</span></button>
        <button type="button" className={category === 'material' ? 'is-active' : ''} onClick={() => setCategory('material')}><Palette size={13} /> Materials <span>{assets.filter((asset) => asset.kind === 'material').length}</span></button>
      </nav>
      <div className="asset-browser">
        <div className="asset-browser-bar">
          <div className="asset-breadcrumb"><Folder size={13} /><span>Assets</span><ChevronRight size={12} /><strong>{category === 'all' ? 'All' : `${category[0].toUpperCase()}${category.slice(1)}s`}</strong></div>
          <label className="asset-search"><Search size={12} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" /></label>
        </div>
        <div className="asset-grid" role="list">
          {visible.map((asset) => (
            <button
              type="button"
              role="listitem"
              key={asset.id}
              className={`asset-card ${selectedAsset === asset.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedAsset(asset.id)}
              onDoubleClick={() => onActivate(asset)}
              title={asset.kind === 'material' && !selectedNode ? 'Select a mesh before applying this material' : `Double-click to use ${asset.name}`}
              data-asset-id={asset.id}
            >
              <AssetPreview asset={asset} />
              <strong>{asset.name}</strong>
              <span>{asset.meta}</span>
            </button>
          ))}
          {visible.length === 0 ? <div className="asset-empty"><Search size={20} /><strong>No matching assets</strong><span>Try a different name or folder.</span></div> : null}
        </div>
      </div>
    </div>
  );
}

function ConsoleView({ entries, onClear }: { entries: ConsoleEntry[]; onClear: () => void }) {
  const icon = (entry: ConsoleEntry) => {
    if (entry.level === 'success') return <CheckCircle2 size={13} />;
    if (entry.level === 'warning') return <AlertTriangle size={13} />;
    return <Info size={13} />;
  };
  return (
    <div className="console-view">
      <div className="console-toolbar">
        <button type="button" onClick={onClear}><Trash2 size={12} /> Clear</button>
        <span>{entries.length} messages</span>
        <span className="console-filter"><Info size={11} /> {entries.filter((entry) => entry.level === 'info').length}</span>
        <span className="console-filter success"><CheckCircle2 size={11} /> {entries.filter((entry) => entry.level === 'success').length}</span>
        <span className="console-filter warning"><AlertTriangle size={11} /> {entries.filter((entry) => entry.level === 'warning').length}</span>
      </div>
      <div className="console-rows">
        {entries.map((entry) => <div className={`console-row ${entry.level}`} key={entry.id}>{icon(entry)}<span>{entry.message}</span><time>{entry.time}</time></div>)}
        {entries.length === 0 ? <div className="console-empty"><Terminal size={22} /><span>Console is clear</span></div> : null}
      </div>
    </div>
  );
}

interface BottomDockProps {
  tab: 'assets' | 'console';
  onTabChange: (tab: 'assets' | 'console') => void;
  assets: StudioAsset[];
  selectedNode: SceneNode | undefined;
  entries: ConsoleEntry[];
  onActivateAsset: (asset: StudioAsset) => void;
  onClearConsole: () => void;
  onClose: () => void;
}

export function BottomDock({ tab, onTabChange, assets, selectedNode, entries, onActivateAsset, onClearConsole, onClose }: BottomDockProps) {
  return (
    <section className="bottom-dock" aria-label="Project dock" data-testid="bottom-dock">
      <div className="bottom-tabs">
        <button type="button" className={tab === 'assets' ? 'is-active' : ''} onClick={() => onTabChange('assets')}><Package size={13} /> Project <span>{assets.length}</span></button>
        <button type="button" className={tab === 'console' ? 'is-active' : ''} onClick={() => onTabChange('console')}><Terminal size={13} /> Console <span>{entries.length}</span></button>
        <div className="bottom-tabs-spacer" />
        <button type="button" className="bottom-close" onClick={onClose} aria-label="Close bottom panel"><X size={14} /></button>
      </div>
      <div className="bottom-content">
        {tab === 'assets' ? <AssetGrid assets={assets} selectedNode={selectedNode} onActivate={onActivateAsset} /> : <ConsoleView entries={entries} onClear={onClearConsole} />}
      </div>
    </section>
  );
}

export function primitiveLabel(primitive: PrimitiveType) {
  return primitive[0].toUpperCase() + primitive.slice(1);
}
