import { useScreenActive } from '../lib/activity';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Route, Stop } from '../lib/bus';

import { nearestRouteStop } from '../lib/route-tools';
import { fetchRouteGeometry, type RouteLine } from '../lib/route-geometry';

export default function RouteMap({ route, stops, position, selected, onSelect }: { route: Route; stops: Stop[]; position: { lat: number; lng: number } | null; selected: Stop | null; onSelect: (stop: Stop) => void }) {
  const active = useScreenActive();
  const [geometry, setGeometry] = useState<{ stops: Stop[]; lines: RouteLine[] | null } | null>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const lines = geometry?.stops === stops ? geometry.lines : null;
  useEffect(() => {
    if (!active) return;
    if (geometry?.stops === stops) return;
    const controller = new AbortController();
    let cancelled = false;
    setGeometry(null); setLineLoading(stops.length > 1);
    const timer = setTimeout(() => controller.abort(), 18000);
    if (stops.length > 1) void fetchRouteGeometry(route, stops, controller.signal).then(lines => { if (!cancelled) setGeometry({ stops, lines }); }).catch(() => { if (!cancelled) setGeometry({ stops, lines: null }); }).finally(() => { if (!cancelled) setLineLoading(false); });
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [route, stops, active]);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const action = useRef(onSelect);
  action.current = onSelect;
  useEffect(() => {
    if (!active || !host.current) return;
    const instance = L.map(host.current, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([22.35, 114.12], 12);
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    return () => { instance.stop(); instance.remove(); map.current = null; };
  }, [active]);
  useEffect(() => {
    const instance = map.current, group = layers.current;
    if (!instance || !group) return;
    group.clearLayers();
    const points: L.LatLngExpression[] = [];
    if (lines) L.polyline(lines, { color: '#de243b', weight: 5, opacity: 0.9, interactive: false }).addTo(group);
    const nearest = nearestRouteStop(stops, position);
    for (const stop of stops) {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng) || !stop.lat || !stop.lng) continue;
      const active = nearest?.id === stop.id && nearest.seq === stop.seq;
      const chosen = selected?.id === stop.id && selected.seq === stop.seq;
      const label = document.createElement('span');
      label.textContent = `${stop.seq}. ${stop.name}`;
      const icon = L.divIcon({ className: `bus-stop-marker${active ? ' nearest' : ''}${chosen ? ' chosen-stop' : ''}`, html: '<span class="bus-stop-sign"><span></span></span>', iconSize: [30, 52], iconAnchor: [15, 52], tooltipAnchor: [0, -40] });
      L.marker([stop.lat, stop.lng], { icon, title: `${active ? '最近車站：' : ''}${stop.seq}. ${stop.name}`, zIndexOffset: active ? 1000 : chosen ? 500 : 0 }).bindTooltip(label).on('click', () => action.current(stop)).addTo(group);
      points.push([stop.lat, stop.lng]);
    }
    if (position) {
      L.circleMarker([position.lat, position.lng], { radius: 9, color: '#fff', fillColor: '#2275df', fillOpacity: 1, weight: 3 }).bindTooltip('目前查詢位置').addTo(group);
      points.push([position.lat, position.lng]);
    }
    if (points.length) instance.fitBounds(L.latLngBounds(points), { padding: [25, 25], maxZoom: 16, animate: false });
    if (selected && selected.lat && selected.lng) instance.setView([selected.lat, selected.lng], 16, { animate: false });
  }, [stops, position, selected, lines, active]);
  return <div><div ref={host} className="route-map" aria-label="路線車站地圖" /><p className="list-note">藍點：查詢位置 · 紅色站牌：最近車站 · 灰色站牌：其他車站（可按下選站）。{lineLoading ? '正在載入行車路線…' : lines ? '紅線：官方行車路線。' : '暫未有可核對的行車線，仍可查看車站。'}底圖由 OpenStreetMap 提供；行車線由運輸署／空間數據共享平台提供，需連線載入。</p></div>;
}
