import type { MapData, Player } from "@game/shared";

export class InteractiveMapSurface {
  private root = document.createElement("div");
  private map: MapData = [];
  private players: Player[] = [];
  private bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private followedCellId: number | null = null;
  constructor() { this.root.className = "interactive-map-surface"; this.root.dataset.ui = "interactive-map"; }
  getElement(): HTMLElement { return this.root; }
  render(map: MapData, players: Player[] = this.players): void {
    this.map = map; this.players = players;
    const ns = "http://www.w3.org/2000/svg"; const cells = [...map];
    if (!cells.length) return;
    const xs=cells.map(c=>c.x), ys=cells.map(c=>c.y);
    const minX=Math.min(...xs)-90, minY=Math.min(...ys)-90, maxX=Math.max(...xs)+90, maxY=Math.max(...ys)+90;
    this.bounds = { minX, minY, maxX, maxY };
    const svg=document.createElementNS(ns,"svg");
    svg.setAttribute("viewBox",`${minX} ${minY} ${maxX-minX} ${maxY-minY}`);
    svg.setAttribute("preserveAspectRatio","xMidYMid meet"); svg.classList.add("interactive-map-surface__svg");
    const byId=new Map(cells.map(c=>[c.id,c])); const links=document.createElementNS(ns,"g"); links.classList.add("interactive-map-surface__links"); const drawn=new Set<string>();
    this.applyViewBox(svg, byId.get(this.followedCellId ?? -1));
    cells.forEach(c=>(c.destinations||[]).forEach(id=>{const d=byId.get(id); if(!d)return; const k=[c.id,id].sort().join(":"); if(drawn.has(k))return; drawn.add(k); const l=document.createElementNS(ns,"line"); l.setAttribute("x1",String(c.x));l.setAttribute("y1",String(c.y));l.setAttribute("x2",String(d.x));l.setAttribute("y2",String(d.y));l.classList.add("map-link");links.appendChild(l);})); svg.appendChild(links);
    const nodes=document.createElementNS(ns,"g"); nodes.classList.add("interactive-map-surface__nodes");
    cells.forEach(c=>{const g=document.createElementNS(ns,"g"); const type=String(c.extra.type ?? "property"); const name=String(c.extra.name ?? `格子 ${c.id}`); const price=Number(c.extra.price ?? 0); g.classList.add("map-node",`map-node--${type}`);g.dataset.cellId=String(c.id);g.setAttribute("transform",`translate(${c.x} ${c.y})`); const r=document.createElementNS(ns,"rect");r.setAttribute("x","-56");r.setAttribute("y","-38");r.setAttribute("width","112");r.setAttribute("height","76");r.setAttribute("rx",type === "property"?"2":"12");r.classList.add("map-node__shape"); const t=document.createElementNS(ns,"text");t.setAttribute("x","-45");t.setAttribute("y","-18");t.classList.add("map-node__type");t.textContent=type.toUpperCase(); const n=document.createElementNS(ns,"text");n.setAttribute("x","-45");n.setAttribute("y","9");n.classList.add("map-node__name");n.textContent=name; const pr=document.createElementNS(ns,"text");pr.setAttribute("x","-45");pr.setAttribute("y","29");pr.classList.add("map-node__price");pr.textContent=price?`$${price}`:"—"; g.append(r,t,n,pr); g.addEventListener("mouseenter",()=>{const b=g.getBoundingClientRect();this.root.dispatchEvent(new CustomEvent("map:hover",{detail:{cellId:c.id,clientX:b.left+b.width/2,clientY:b.top}}));}); g.addEventListener("mouseleave",()=>this.root.dispatchEvent(new CustomEvent("map:leave")));nodes.appendChild(g);});
    svg.appendChild(nodes);
    const pieces=document.createElementNS(ns,"g"); pieces.classList.add("interactive-map-surface__players");
    this.players.filter((player): player is Player => Boolean(player)).forEach((player,i)=>{const cell=byId.get(player.position.cellId);if(!cell)return;const g=document.createElementNS(ns,"g");g.classList.add("map-player");g.setAttribute("transform",`translate(${cell.x + (i%3-1)*18} ${cell.y-42-Math.floor(i/3)*8})`);g.dataset.playerId=player.id; const head=document.createElementNS(ns,"circle");head.setAttribute("r","12");head.classList.add("map-player__head"); const body=document.createElementNS(ns,"path");body.setAttribute("d","M-18 34 L-11 2 L11 2 L18 34 Z");body.classList.add("map-player__body");g.append(head,body);pieces.appendChild(g);});
    svg.appendChild(pieces); this.root.replaceChildren(svg);
  }
  updatePlayers(players: Player[]): void { this.players=players; if(this.map.length) this.render(this.map,players); }

  followPlayer(cellId: number): void {
    this.followedCellId = cellId;
    if (this.map.length) this.render(this.map, this.players);
  }

  private applyViewBox(svg: SVGSVGElement, followedCell: MapData[number] | undefined): void {
    if (!this.bounds || !followedCell) return;
    const width = Math.max(720, (this.bounds.maxX - this.bounds.minX) * 0.68);
    const height = width * 0.625;
    const centerX = Math.min(this.bounds.maxX - width / 2, Math.max(this.bounds.minX + width / 2, followedCell.x));
    const centerY = Math.min(this.bounds.maxY - height / 2, Math.max(this.bounds.minY + height / 2, followedCell.y));
    svg.setAttribute('viewBox', `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`);
  }
}
