import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Stop } from '../lib/bus';

export default function RouteMap({ stops, position, selected, onSelect }: { stops: Stop[]; position: { lat: number; lng: number } | null; selected: Stop | null; onSelect: (stop: Stop) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const action = useRef(onSelect);
  action.current = onSelect;
  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([22.35, 114.12], 12);
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    return () => { instance.stop(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const instance = map.current, group = layers.current;
    if (!instance || !group) return;
    group.clearLayers();
    const points: L.LatLngExpression[] = [];
    for (const stop of stops) {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng) || !stop.lat || !stop.lng) continue;
      const active = selected?.id === stop.id && selected.seq === stop.seq;
      const label = document.createElement('span');
      label.textContent = `${stop.seq}. ${stop.name}`;
      L.circleMarker([stop.lat, stop.lng], { radius: active ? 10 : 6, color: active ? '#b74125' : '#164f43', fillOpacity: 0.9, weight: 2 }).bindTooltip(label).on('click', () => action.current(stop)).addTo(group);
      points.push([stop.lat, stop.lng]);
    }
    if (position) {
      L.circleMarker([position.lat, position.lng], { radius: 9, color: '#fff', fillColor: '#2275df', fillOpacity: 1, weight: 3 }).bindTooltip('目前查詢位置').addTo(group);
      points.push([position.lat, position.lng]);
    }
    if (points.length) instance.fitBounds(L.latLngBounds(points), { padding: [25, 25], maxZoom: 16, animate: false });
    if (selected && selected.lat && selected.lng) instance.setView([selected.lat, selected.lng], 16, { animate: false });
  }, [stops, position, selected]);
  return <div><div ref={host} className="route-map" aria-label="路線車站地圖" /><p className="list-note">藍點：查詢位置 · 圓點：車站（可按下選站）。地圖未繪製行車路線。底圖由 OpenStreetMap 提供，需連線載入。</p></div>;
}
