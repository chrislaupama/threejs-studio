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
  Keyboard,
  Lightbulb,
  LockKeyhole,
  Package,
  Palette,
  Plus,
  Search,
  Terminal,
  Trash2,
  Triangle,
  UnlockKeyhole,
  Waves,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createGameplayComponent } from './project';
import type {
  ConsoleEntry,
  GameplayComponent,
  PrimitiveType,
  ProjectDocument,
  ProjectSettings,
  SceneNode,
  StudioAsset,
} from './types';

type ExperienceLevel = 'essentials' | 'advanced';

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
  experience: ExperienceLevel;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onAdd: () => void;
}

interface TreeRowProps extends Omit<HierarchyProps, 'project' | 'onAdd' | 'experience'> {
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
            disabled={disabled}
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
            disabled={disabled}
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
  experience,
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
          <strong>{experience === 'essentials' ? 'Objects' : 'Hierarchy'}</strong>
        </div>
        <div className="dock-header-actions">
          <IconButton label="Add object" compact onClick={onAdd} disabled={disabled}><Plus size={14} /></IconButton>
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
  experience: ExperienceLevel;
  onUpdate: (node: SceneNode, label: string) => void;
  onUpdateSettings: (settings: ProjectSettings, label: string) => void;
  onDelete: () => void;
}

function ComponentHeading({ icon, title, onRemove }: { icon: ReactNode; title: string; onRemove?: () => void }) {
  return (
    <div className="component-heading">
      <span>{icon}</span>
      <strong>{title}</strong>
      {onRemove ? <button type="button" aria-label={`Remove ${title}`} onClick={onRemove}><Trash2 size={12} /></button> : null}
    </div>
  );
}

const componentCopy: Record<GameplayComponent['type'], { essential: string; advanced: string; description: string }> = {
  rotate: { essential: 'Spin', advanced: 'Rotate Component', description: 'Spin continuously while the game is playing.' },
  float: { essential: 'Float', advanced: 'Float Component', description: 'Gently bob along one axis while playing.' },
  keyboardMove: { essential: 'Move with Keyboard', advanced: 'Keyboard Move Component', description: 'Control this object with WASD or the arrow keys.' },
};

function GameplayComponentEditor({
  component,
  experience,
  disabled,
  onChange,
  onRemove,
}: {
  component: GameplayComponent;
  experience: ExperienceLevel;
  disabled: boolean;
  onChange: (component: GameplayComponent, label: string) => void;
  onRemove: () => void;
}) {
  const copy = componentCopy[component.type];
  const icon = component.type === 'keyboardMove' ? <Keyboard size={14} /> : component.type === 'float' ? <Waves size={14} /> : <FileBox size={14} />;
  const advancedFields = (
    <div className="component-advanced-grid">
      {component.type === 'rotate' || component.type === 'float' ? (
        <label className="property-row"><span className="property-label">Axis</span><select value={component.axis} disabled={disabled} onChange={(event) => onChange({ ...component, axis: event.target.value as 'x' | 'y' | 'z' }, 'Change motion axis')}><option value="x">X axis</option><option value="y">Y axis</option><option value="z">Z axis</option></select></label>
      ) : null}
      {component.type === 'float' ? <label className="property-row"><span className="property-label">Distance</span><NumberField label="m" value={component.distance} disabled={disabled} onCommit={(value) => onChange({ ...component, distance: Math.max(0, value) }, 'Change float distance')} /></label> : null}
      {component.type === 'float' ? <label className="property-row"><span className="property-label">Phase</span><NumberField label="°" value={component.phase * 180 / Math.PI} disabled={disabled} onCommit={(value) => onChange({ ...component, phase: value * Math.PI / 180 }, 'Change float phase')} /></label> : null}
      {component.type === 'keyboardMove' ? <label className="property-row"><span className="property-label">Movement plane</span><select value={component.plane} disabled={disabled} onChange={(event) => onChange({ ...component, plane: event.target.value as 'xz' | 'xy' }, 'Change movement plane')}><option value="xz">Ground (X / Z)</option><option value="xy">Screen (X / Y)</option></select></label> : null}
      <div className="component-id"><span>Component ID</span><code>{component.id}</code></div>
    </div>
  );

  return (
    <details className="component gameplay-component" open data-component-id={component.id}>
      <summary><ComponentHeading icon={icon} title={experience === 'essentials' ? copy.essential : copy.advanced} onRemove={disabled ? undefined : onRemove} /></summary>
      <div className="component-body property-stack">
        <p className="component-description">{copy.description}</p>
        <label className="property-row checkbox-row"><span className="property-label">Active</span><label><input type="checkbox" checked={component.enabled} disabled={disabled} onChange={(event) => onChange({ ...component, enabled: event.target.checked }, 'Toggle gameplay component')} /> Run in Play mode</label></label>
        <label className="property-row"><span className="property-label">Speed</span><NumberField label="×" value={component.speed} step={0.1} disabled={disabled} onCommit={(value) => onChange({ ...component, speed: Math.max(0, value) }, 'Change component speed')} /></label>
        {experience === 'advanced' ? advancedFields : (
          <details className="advanced-settings" data-testid="advanced-settings-toggle"><summary>Advanced settings</summary>{advancedFields}</details>
        )}
      </div>
    </details>
  );
}

export function InspectorPanel({ node, disabled, project, experience, onUpdate, onUpdateSettings, onDelete }: InspectorProps) {
  const [componentMenuOpen, setComponentMenuOpen] = useState(false);
  if (!node) {
    return (
      <aside className="dock inspector-panel" aria-label="Inspector" data-testid="inspector-panel">
        <div className="dock-header"><div><span className="dock-eyebrow">Properties</span><strong>{experience === 'essentials' ? 'Details' : 'Inspector'}</strong></div></div>
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

  const renderMaterialTechnicalFields = () => node.material ? (
    <div className="component-advanced-grid">
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
  ) : null;

  return (
    <aside className="dock inspector-panel" aria-label="Inspector" data-testid="inspector-panel">
      <div className="dock-header inspector-titlebar">
          <div>
            <span className="dock-eyebrow">Properties</span>
          <strong>{experience === 'essentials' ? 'Details' : 'Inspector'}</strong>
          </div>
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
        </div>

        {node.id !== 'scene-root' ? <details className="component" open>
          <summary><ComponentHeading icon={<Box size={14} />} title="Transform" /></summary>
          <div className="component-body">
            <VectorEditor label="Position" values={node.transform.position} disabled={disabled || node.locked} onChange={(value) => updateTransform('position', value)} />
            <VectorEditor label="Rotation" values={node.transform.rotation} degrees disabled={disabled || node.locked} onChange={(value) => updateTransform('rotation', value)} />
            <VectorEditor label="Scale" values={node.transform.scale} disabled={disabled || node.locked} onChange={(value) => updateTransform('scale', value)} />
            {experience === 'essentials' ? <button type="button" className="reset-transform" disabled={disabled || node.locked} onClick={() => onUpdate({ ...node, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, 'Reset transform')}>Reset transform</button> : null}
          </div>
        </details> : null}

        {node.id === 'scene-root' ? (
          <details className="component world-settings" open>
            <summary><ComponentHeading icon={<Grid3X3 size={14} />} title={experience === 'essentials' ? 'World' : 'Scene Environment'} /></summary>
            <div className="component-body property-stack">
              <p className="component-description">Set the atmosphere shared by the editor, Play mode, and your web build.</p>
              <label className="property-row color-property"><span className="property-label">Background</span><span className="color-control"><input type="color" value={project.settings.background} disabled={disabled} onChange={(event) => onUpdateSettings({ ...project.settings, background: event.target.value }, 'Change world background')} /><code>{project.settings.background.toUpperCase()}</code></span></label>
              <label className="property-row checkbox-row"><span className="property-label">Atmosphere</span><label><input type="checkbox" checked={project.settings.fogEnabled} disabled={disabled} onChange={(event) => onUpdateSettings({ ...project.settings, fogEnabled: event.target.checked }, 'Toggle world fog')} /> Depth fog</label></label>
              {experience === 'advanced' ? (
                <div className="component-advanced-grid">
                  <label className="property-row color-property"><span className="property-label">Fog color</span><span className="color-control"><input type="color" value={project.settings.fogColor} disabled={disabled} onChange={(event) => onUpdateSettings({ ...project.settings, fogColor: event.target.value }, 'Change fog color')} /><code>{project.settings.fogColor.toUpperCase()}</code></span></label>
                  <label className="property-row"><span className="property-label">Fog start</span><NumberField label="m" value={project.settings.fogNear} disabled={disabled} onCommit={(value) => onUpdateSettings({ ...project.settings, fogNear: Math.max(0, Math.min(value, project.settings.fogFar - 0.1)) }, 'Change fog start')} /></label>
                  <label className="property-row"><span className="property-label">Fog end</span><NumberField label="m" value={project.settings.fogFar} disabled={disabled} onCommit={(value) => onUpdateSettings({ ...project.settings, fogFar: Math.max(project.settings.fogNear + 0.1, value) }, 'Change fog end')} /></label>
                  <label className="property-row"><span className="property-label">Exposure</span><NumberField label="×" value={project.settings.exposure} disabled={disabled} onCommit={(value) => onUpdateSettings({ ...project.settings, exposure: Math.min(4, Math.max(0.1, value)) }, 'Change exposure')} /></label>
                  <label className="property-row"><span className="property-label">Grid size</span><NumberField label="m" value={project.settings.gridSize} step={1} disabled={disabled} onCommit={(value) => onUpdateSettings({ ...project.settings, gridSize: Math.max(1, value) }, 'Change grid size')} /></label>
                  <label className="property-row"><span className="property-label">Grid divisions</span><NumberField label="" value={project.settings.gridDivisions} step={1} disabled={disabled} onCommit={(value) => onUpdateSettings({ ...project.settings, gridDivisions: Math.max(1, Math.round(value)) }, 'Change grid divisions')} /></label>
                  <label className="property-row checkbox-row"><span className="property-label">Rendering</span><label><input type="checkbox" checked={project.settings.shadows} disabled={disabled} onChange={(event) => onUpdateSettings({ ...project.settings, shadows: event.target.checked }, 'Toggle project shadows')} /> Realtime shadows</label></label>
                </div>
              ) : (
                <details className="advanced-settings" data-testid="advanced-settings-toggle"><summary>Advanced world settings</summary><div className="component-advanced-grid">
                  <label className="property-row color-property"><span className="property-label">Fog color</span><span className="color-control"><input type="color" value={project.settings.fogColor} disabled={disabled} onChange={(event) => onUpdateSettings({ ...project.settings, fogColor: event.target.value }, 'Change fog color')} /><code>{project.settings.fogColor.toUpperCase()}</code></span></label>
                  <label className="property-row"><span className="property-label">Exposure</span><NumberField label="×" value={project.settings.exposure} disabled={disabled} onCommit={(value) => onUpdateSettings({ ...project.settings, exposure: Math.min(4, Math.max(0.1, value)) }, 'Change exposure')} /></label>
                </div></details>
              )}
            </div>
          </details>
        ) : null}

        {node.kind === 'mesh' && node.material ? (
          <details className="component" open>
            <summary><ComponentHeading icon={<Palette size={14} />} title={experience === 'essentials' ? 'Appearance' : 'Mesh Renderer'} /></summary>
            <div className="component-body property-stack">
              <div className="material-preview-row">
                <span className="property-label">Material</span>
                <div className="material-slot"><span style={{ background: node.material.color }} /><strong>{experience === 'essentials' ? 'Standard material' : 'Standard PBR'}</strong></div>
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
              {experience === 'advanced' ? renderMaterialTechnicalFields() : <details className="advanced-settings" data-testid="advanced-settings-toggle"><summary>Advanced material settings</summary>{renderMaterialTechnicalFields()}</details>}
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

        {node.components.map((component) => (
          <GameplayComponentEditor
            key={component.id}
            component={component}
            experience={experience}
            disabled={disabled}
            onChange={(nextComponent, label) => onUpdate({ ...node, components: node.components.map((entry) => entry.id === component.id ? nextComponent : entry) }, label)}
            onRemove={() => onUpdate({ ...node, components: node.components.filter((entry) => entry.id !== component.id) }, `Remove ${componentCopy[component.type].essential} component`)}
          />
        ))}

        {node.id !== 'scene-root' ? (
          <div className="add-component-wrap">
            <button type="button" className="add-component-button" disabled={disabled} data-testid="make-it-move" onClick={() => setComponentMenuOpen((open) => !open)}><Plus size={14} /> {experience === 'essentials' ? 'Make it move' : 'Add Component'}</button>
            {componentMenuOpen ? (
              <div className="component-menu">
                <span>{experience === 'essentials' ? 'Choose motion' : 'Gameplay components'}</span>
                <button type="button" onClick={() => { onUpdate({ ...node, components: [...node.components, createGameplayComponent('keyboardMove')] }, 'Add Keyboard Move component'); setComponentMenuOpen(false); }}><Keyboard size={14} /><span><strong>Move with Keyboard</strong><small>Control with WASD or arrow keys</small></span></button>
                <button type="button" onClick={() => { onUpdate({ ...node, components: [...node.components, createGameplayComponent('rotate')] }, 'Add Rotate component'); setComponentMenuOpen(false); }}><FileBox size={14} /><span><strong>Spin</strong><small>Rotate continuously in Play mode</small></span></button>
                <button type="button" onClick={() => { onUpdate({ ...node, components: [...node.components, createGameplayComponent('float')] }, 'Add Float component'); setComponentMenuOpen(false); }}><Waves size={14} /><span><strong>Float</strong><small>Gently bob along an axis</small></span></button>
              </div>
            ) : null}
          </div>
        ) : null}

        {node.id !== 'scene-root' ? <button type="button" className="inspector-delete" disabled={disabled} onClick={onDelete}><Trash2 size={13} /> Remove object</button> : null}
        {experience === 'advanced' ? <div className="inspector-path">{project.sceneName} / {node.name}<code>{node.id}</code></div> : null}
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
  const activeAsset = assets.find((asset) => asset.id === selectedAsset);

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
        {activeAsset ? <div className="asset-action-bar"><span><strong>{activeAsset.name}</strong><small>{activeAsset.meta}</small></span><button type="button" onClick={() => onActivate(activeAsset)}>{activeAsset.kind === 'material' ? 'Apply to selected' : activeAsset.kind === 'primitive' ? 'Add to scene' : 'Open scene'}</button></div> : null}
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
