import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const ATHLETES = [
  { id: 123682, n: "Manav THAKKAR", g: "M", r: 34, m: 133 },
  { id: 103126, n: "Sathiyan GNANASEKARAN", g: "M", r: 44, m: 109 },
  { id: 122718, n: "Sreeja AKULA", g: "W", r: 44, m: 116 },
  { id: 115920, n: "Manika BATRA", g: "W", r: 46, m: 113 },
  { id: 131879, n: "Manush SHAH", g: "M", r: 65, m: 128 },
  { id: 111641, n: "Harmeet DESAI", g: "M", r: 80, m: 140 },
  { id: 137850, n: "Yashaswini GHORPADE", g: "W", r: 91, m: 174 },
  { id: 200316, n: "Ankur BHATTACHARJEE", g: "M", r: 108, m: 202 },
  { id: 131395, n: "Diya CHITALE", g: "W", r: 90, m: 114 },
  { id: 131917, n: "Payas JAIN", g: "M", r: 115, m: 161 },
];

const RECORDS = {
  "103126": { W: 25, L: 19 }, "111641": { W: 27, L: 20 },
  "115920": { W: 16, L: 28 }, "122718": { W: 12, L: 21 },
  "123682": { W: 20, L: 24 }, "131395": { W: 24, L: 20 },
  "131879": { W: 36, L: 22 }, "131917": { W: 20, L: 21 },
  "137850": { W: 22, L: 24 }, "200316": { W: 74, L: 27 },
};

const RANKS = {
  "103126": [["2024-09-03",62],["2024-10-01",63],["2024-11-05",74],["2024-12-31",72],["2025-01-14",74],["2025-02-11",69],["2025-03-11",70],["2025-03-25",101],["2025-04-15",105],["2025-05-13",109],["2025-06-10",107],["2025-07-08",193],["2025-07-15",102],["2025-08-19",71],["2025-09-23",53],["2025-10-21",56],["2025-11-04",55]],
  "111641": [["2024-09-03",86],["2024-10-01",85],["2024-11-05",70],["2024-12-31",71],["2025-01-14",70],["2025-02-11",70],["2025-03-18",66],["2025-04-01",68],["2025-05-13",71],["2025-06-10",73],["2025-07-08",72],["2025-07-29",77],["2025-08-19",82],["2025-09-02",64],["2025-10-14",66],["2025-10-28",63],["2025-11-04",80]],
  "115920": [["2024-09-03",26],["2024-10-29",26],["2024-11-12",25],["2024-12-31",24],["2025-01-14",27],["2025-02-11",28],["2025-03-18",27],["2025-04-08",30],["2025-05-13",46],["2025-06-10",46],["2025-07-01",48],["2025-08-05",52],["2025-09-09",54],["2025-10-07",44],["2025-10-28",52],["2025-11-04",52]],
  "122718": [["2024-09-03",22],["2024-10-01",23],["2024-11-05",24],["2024-12-31",22],["2025-01-14",25],["2025-02-11",29],["2025-03-18",28],["2025-03-25",33],["2025-04-15",35],["2025-05-13",34],["2025-06-17",33],["2025-06-24",63],["2025-07-29",37],["2025-08-26",42],["2025-09-30",42],["2025-10-28",37],["2025-11-04",36]],
  "123682": [["2024-09-03",56],["2024-10-01",57],["2024-11-05",61],["2024-12-31",59],["2025-01-14",59],["2025-02-11",60],["2025-03-18",56],["2025-04-01",47],["2025-05-13",49],["2025-06-17",45],["2025-07-15",52],["2025-07-29",45],["2025-08-26",43],["2025-09-30",42],["2025-10-21",38],["2025-11-04",38]],
  "131395": [["2024-12-03",125],["2024-12-31",122],["2025-01-14",115],["2025-02-11",110],["2025-03-18",110],["2025-04-29",90],["2025-05-27",86],["2025-06-17",86],["2025-07-15",96],["2025-08-05",87],["2025-09-16",86],["2025-10-21",82],["2025-11-04",85]],
  "131879": [["2024-09-03",112],["2024-10-15",105],["2024-11-05",99],["2024-12-31",98],["2025-01-21",78],["2025-02-11",76],["2025-03-18",74],["2025-04-01",73],["2025-05-27",67],["2025-06-17",66],["2025-07-08",77],["2025-08-05",70],["2025-09-09",69],["2025-10-07",72],["2025-11-04",73]],
  "131917": [["2024-09-03",240],["2024-10-08",199],["2024-11-05",218],["2024-12-31",212],["2025-02-18",224],["2025-04-01",155],["2025-04-22",147],["2025-05-20",146],["2025-06-10",155],["2025-07-15",149],["2025-08-05",132],["2025-09-09",146],["2025-10-21",150],["2025-11-04",151]],
  "137850": [["2024-09-03",85],["2024-10-08",81],["2024-10-15",89],["2024-11-05",88],["2024-12-31",87],["2025-01-14",88],["2025-02-11",82],["2025-03-18",80],["2025-04-08",77],["2025-05-13",76],["2025-05-27",84],["2025-06-17",79],["2025-06-24",93],["2025-07-15",87],["2025-08-05",76],["2025-09-09",72],["2025-10-07",89],["2025-10-21",81],["2025-11-04",83]],
  "200316": [["2024-09-03",238],["2024-10-01",201],["2024-10-15",170],["2024-11-05",183],["2024-12-31",175],["2025-01-14",173],["2025-02-25",162],["2025-03-18",190],["2025-04-22",163],["2025-05-20",156],["2025-06-17",156],["2025-07-15",163],["2025-08-26",143],["2025-09-30",149],["2025-10-07",118],["2025-10-28",130],["2025-11-04",128]],
};

const MATCHES = {
  "103126": [
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"CASTRO R.",on:"MEX",s:"1-3",rp:"Qualifying R2" },
    { r:"W",t:"1",e:"Singapore Smash",d:"Feb 26",o:"OTALVARO E.",on:"COL",s:"3-1",rp:"Qualifying R1" },
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"JANCARIK L.",on:"CZE",s:"0-3",rp:"Quarterfinal" },
    { r:"W",t:"4",e:"SC Chennai",d:"Feb 26",o:"IONESCU E.",on:"ROU",s:"2-3",rp:"Round of 16" },
    { r:"W",t:"4",e:"SC Chennai",d:"Feb 26",o:"LIM J.",on:"KOR",s:"1-3",rp:"Round of 32" },
    { r:"L",t:"7",e:"Feeder Doha",d:"Jan 26",o:"YOSHIYAMA R.",on:"JPN",s:"2-3",rp:"Semifinal" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"WEN R.",on:"CHN",s:"0-3",rp:"Round of 32" },
    { r:"L",t:"4",e:"SC London",d:"Oct 25",o:"MATSUSHIMA S.",on:"JPN",s:"0-3",rp:"Round of 32" },
  ],
  "111641": [
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"URSU V.",on:"MDA",s:"3-2",rp:"Qualifying R3" },
    { r:"W",t:"1",e:"Singapore Smash",d:"Feb 26",o:"LY E.",on:"CAN",s:"1-3",rp:"Qualifying R2" },
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"IONESCU E.",on:"ROU",s:"3-2",rp:"Round of 32" },
    { r:"L",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"SHETTY S.",on:"IND",s:"3-2",rp:"Round of 32" },
    { r:"L",t:"7",e:"Feeder Parma",d:"Nov 25",o:"SEYFRIED J.",on:"FRA",s:"3-1",rp:"Semifinal" },
    { r:"W",t:"7",e:"Feeder Parma",d:"Nov 25",o:"BADOWSKI M.",on:"POL",s:"1-3",rp:"Quarterfinal" },
    { r:"L",t:"4",e:"SC London",d:"Oct 25",o:"STUMPER K.",on:"GER",s:"3-0",rp:"Round of 16" },
    { r:"W",t:"4",e:"SC London",d:"Oct 25",o:"BAE H.",on:"AUS",s:"3-0",rp:"Round of 32" },
  ],
  "115920": [
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"ZHU Yuling",on:"MAC",s:"1-3",rp:"Round of 64" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"SHI Xunyao",on:"CHN",s:"3-2",rp:"Round of 16" },
    { r:"W",t:"6",e:"Contender Muscat",d:"Jan 26",o:"PANFILOVA M.",on:"AIN",s:"3-2",rp:"Round of 32" },
    { r:"L",t:"4",e:"SC Doha",d:"Jan 26",o:"ZHU Yuling",on:"MAC",s:"0-3",rp:"Round of 16" },
    { r:"L",t:"3",e:"Champions Frankfurt",d:"Nov 25",o:"KAUFMANN A.",on:"GER",s:"0-3",rp:"Round of 32" },
    { r:"L",t:"4",e:"SC London",d:"Oct 25",o:"CHENG I-Ching",on:"TPE",s:"3-0",rp:"Quarterfinal" },
    { r:"W",t:"4",e:"SC London",d:"Oct 25",o:"SHI Xunyao",on:"CHN",s:"3-1",rp:"Round of 16" },
    { r:"L",t:"1",e:"China Smash",d:"Sep 25",o:"WANG Manyu",on:"CHN",s:"0-3",rp:"Round of 32" },
  ],
  "122718": [
    { r:"L",t:"3",e:"Champions Chongqing",d:"Mar 26",o:"HURSEY A.",on:"WAL",s:"1-3",rp:"Round of 32" },
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"HURSEY A.",on:"WAL",s:"1-3",rp:"Round of 64" },
    { r:"L",t:"1",e:"China Smash",d:"Sep 25",o:"WANG Yidi",on:"CHN",s:"0-3",rp:"Round of 32" },
    { r:"W",t:"1",e:"China Smash",d:"Sep 25",o:"YANG Y.",on:"CHN",s:"0-3",rp:"Round of 64" },
    { r:"L",t:"3",e:"Champions Macao",d:"Sep 25",o:"ZHU Yuling",on:"MAC",s:"3-0",rp:"Round of 32" },
    { r:"L",t:"1",e:"Europe Smash",d:"Aug 25",o:"ZHU Yuling",on:"MAC",s:"3-1",rp:"Round of 32" },
    { r:"W",t:"1",e:"Europe Smash",d:"Aug 25",o:"BATRA M.",on:"IND",s:"2-3",rp:"Round of 64" },
    { r:"L",t:"7",e:"Feeder Spokane",d:"Aug 25",o:"SHIBATA S.",on:"JPN",s:"0-3",rp:"Quarterfinal" },
    { r:"L",t:"6",e:"Contender Lagos",d:"Jul 25",o:"HASHIMOTO H.",on:"JPN",s:"1-4",rp:"Final" },
  ],
  "123682": [
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"HUANG Y.",on:"CHN",s:"1-3",rp:"Round of 64" },
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"JANCARIK L.",on:"CZE",s:"3-1",rp:"Round of 32" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"LIN Shidong",on:"CHN",s:"3-1",rp:"Round of 32" },
    { r:"L",t:"3",e:"Champions Doha",d:"Jan 26",o:"MOREGARD T.",on:"SWE",s:"3-1",rp:"Round of 16" },
    { r:"W",t:"3",e:"Champions Doha",d:"Jan 26",o:"GAUZY S.",on:"FRA",s:"2-3",rp:"Round of 32" },
    { r:"L",t:"3",e:"Champions Frankfurt",d:"Nov 25",o:"LEBRUN F.",on:"FRA",s:"0-3",rp:"Round of 16" },
    { r:"W",t:"3",e:"Champions Frankfurt",d:"Nov 25",o:"PUCAR T.",on:"CRO",s:"3-2",rp:"Round of 32" },
    { r:"L",t:"4",e:"SC London",d:"Oct 25",o:"QIU Dang",on:"GER",s:"0-3",rp:"Round of 16" },
  ],
  "131879": [
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"CHO S.",on:"KOR",s:"3-2",rp:"Qualifying R2" },
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"JANCARIK L.",on:"CZE",s:"1-3",rp:"Round of 16" },
    { r:"W",t:"4",e:"SC Chennai",d:"Feb 26",o:"PARK G.",on:"KOR",s:"3-0",rp:"Round of 32" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"JORGIC D.",on:"SLO",s:"0-3",rp:"Round of 16" },
    { r:"W",t:"6",e:"Contender Muscat",d:"Jan 26",o:"JANCARIK L.",on:"CZE",s:"3-2",rp:"Group stage" },
    { r:"L",t:"4",e:"SC Doha",d:"Jan 26",o:"YOSHIYAMA R.",on:"JPN",s:"1-3",rp:"Round of 64" },
    { r:"W",t:"4",e:"SC Doha",d:"Jan 26",o:"CHANG Y.",on:"TPE",s:"3-2",rp:"Qualifying R3" },
    { r:"W",t:"4",e:"SC Doha",d:"Jan 26",o:"WANG Yang",on:"SVK",s:"3-1",rp:"Qualifying R2" },
  ],
  "131395": [
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"ZARIF A.",on:"FRA",s:"2-3",rp:"Qualifying R2" },
    { r:"W",t:"1",e:"Singapore Smash",d:"Feb 26",o:"WEGRZYN K.",on:"POL",s:"3-2",rp:"Qualifying R1" },
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"SATO H.",on:"JPN",s:"0-3",rp:"Round of 32" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"HAN F.",on:"CHN",s:"1-3",rp:"Qual. Elimination" },
    { r:"W",t:"6",e:"Contender Muscat",d:"Jan 26",o:"YAN Y.",on:"CHN",s:"3-1",rp:"Group stage" },
    { r:"L",t:"4",e:"SC Doha",d:"Jan 26",o:"TSAI Y.",on:"TPE",s:"3-1",rp:"Qualifying R3" },
    { r:"L",t:"4",e:"SC Muscat",d:"Nov 25",o:"SHAO J.",on:"POR",s:"0-3",rp:"Round of 64" },
    { r:"L",t:"4",e:"SC London",d:"Oct 25",o:"HARIMOTO M.",on:"JPN",s:"3-0",rp:"Round of 32" },
  ],
  "131917": [
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"MOVILEANU D.",on:"ROU",s:"3-2",rp:"Round of 64" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"PANG K.",on:"SGP",s:"0-3",rp:"Qual. Elimination" },
    { r:"L",t:"4",e:"SC Doha",d:"Jan 26",o:"XU Y.",on:"CHN",s:"0-3",rp:"Qualifying R2" },
    { r:"L",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"SHAH Manush",on:"IND",s:"3-2",rp:"Final" },
    { r:"W",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"PAL A.",on:"IND",s:"3-0",rp:"Semifinal" },
    { r:"W",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"LY E.",on:"CAN",s:"3-1",rp:"Quarterfinal" },
    { r:"W",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"ARYA S.",on:"IND",s:"3-0",rp:"Round of 16" },
    { r:"W",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"CHOPDA K.",on:"IND",s:"3-0",rp:"Round of 32" },
  ],
  "137850": [
    { r:"L",t:"1",e:"Singapore Smash",d:"Feb 26",o:"MOYLAND S.",on:"USA",s:"3-1",rp:"Qualifying R2" },
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"SIVASANKAR Y.",on:"IND",s:"0-3",rp:"Round of 64" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"LOY M.",on:"SGP",s:"2-3",rp:"Qual. Elimination" },
    { r:"W",t:"6",e:"Contender Muscat",d:"Jan 26",o:"WONG H.",on:"HKG",s:"3-2",rp:"Group stage" },
    { r:"L",t:"4",e:"SC Doha",d:"Jan 26",o:"GHOSH S.",on:"IND",s:"0-3",rp:"Qualifying R3" },
    { r:"L",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"KUTUMBALE A.",on:"IND",s:"1-3",rp:"Quarterfinal" },
    { r:"W",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"WANI S.",on:"IND",s:"3-0",rp:"Round of 16" },
    { r:"L",t:"4",e:"SC London",d:"Oct 25",o:"CHITALE D.",on:"IND",s:"3-2",rp:"Round of 64" },
  ],
  "200316": [
    { r:"L",t:"4",e:"SC Chennai",d:"Feb 26",o:"YOSHIMURA K.",on:"JPN",s:"1-3",rp:"Round of 32" },
    { r:"W",t:"4",e:"SC Chennai",d:"Feb 26",o:"BOURRASSAUD F.",on:"FRA",s:"1-3",rp:"Round of 64" },
    { r:"W",t:"4",e:"SC Chennai",d:"Feb 26",o:"KUMAR U.",on:"IND",s:"3-0",rp:"Qualifying R3" },
    { r:"L",t:"6",e:"Contender Muscat",d:"Jan 26",o:"FALCK M.",on:"SWE",s:"3-0",rp:"Group stage" },
    { r:"L",t:"4",e:"SC Doha",d:"Jan 26",o:"DE NODREST L.",on:"FRA",s:"1-3",rp:"Qualifying R2" },
    { r:"L",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"SURAVAJJULA S.",on:"IND",s:"3-0",rp:"Quarterfinal" },
    { r:"W",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"DANI M.",on:"IND",s:"1-3",rp:"Round of 16" },
    { r:"W",t:"7",e:"Feeder Vadodara",d:"Jan 26",o:"PRADHIVADHI A.",on:"IND",s:"1-3",rp:"Round of 32" },
  ],
};

const TIER_COLORS = {
  "1": "#E24B4A", "2": "#D85A30", "3": "#BA7517",
  "4": "#534AB7", "5": "#1D9E75", "6": "#378ADD", "7": "#888780",
};

const TIER_NAMES = {
  "1": "Grand Smash", "2": "World Cup", "3": "Champions",
  "4": "Star Contender", "5": "Continental", "6": "Contender", "7": "Feeder",
};

export default function App() {
  const [sel, setSel] = useState(null);
  const at = ATHLETES.find((x) => x.id === sel);

  const rk = useMemo(
    () => (sel ? (RANKS[sel] || []).map(([d, r]) => ({ date: d, rank: r })) : []),
    [sel]
  );

  const wl = sel ? RECORDS[sel] || { W: 0, L: 0 } : { W: 0, L: 0 };
  const ml = sel ? MATCHES[sel] || [] : [];
  const w = wl.W, l = wl.L, tot = w + l;
  const wr = tot > 0 ? Math.round((w / tot) * 100) : 0;
  const ranks = rk.map((x) => x.rank);
  const best = ranks.length ? Math.min(...ranks) : null;
  const cur = ranks.length ? ranks[ranks.length - 1] : null;
  const prev = ranks.length >= 2 ? ranks[ranks.length - 2] : null;
  const delta = prev && cur ? prev - cur : 0;

  const cardStyle = {
    padding: "14px 16px",
    borderRadius: "var(--border-radius-lg, 12px)",
    border: "1px solid var(--color-border-tertiary, #e5e5e5)",
    background: "var(--color-background-primary, #fff)",
  };

  return (
    <div style={{ fontFamily: "var(--font-sans, system-ui)", color: "var(--color-text-primary, #1a1a1a)", minHeight: 420, padding: "4px 0 32px" }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em" }}>
          TOPS <span style={{ color: "#534AB7" }}>Athlete Intelligence</span>
        </div>
        <select
          value={sel || ""}
          onChange={(e) => setSel(e.target.value ? +e.target.value : null)}
          style={{
            padding: "9px 14px", borderRadius: 10,
            border: "1px solid var(--color-border-secondary, #ccc)",
            background: "var(--color-background-secondary, #fafafa)",
            color: "var(--color-text-primary, #1a1a1a)",
            fontSize: 14, fontWeight: 500, minWidth: 270, cursor: "pointer",
          }}
        >
          <option value="">Select an athlete</option>
          {ATHLETES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.n} · #{a.r} · {a.g === "M" ? "Men" : "Women"}
            </option>
          ))}
        </select>
      </div>

      {!sel && (
        <div style={{ padding: "80px 20px", textAlign: "center", color: "var(--color-text-tertiary, #999)", fontSize: 14 }}>
          Select an Indian athlete to view their performance dashboard
        </div>
      )}

      {sel && at && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              {
                lb: "Current rank", v: cur ? `#${cur}` : "—",
                sub: delta > 0 ? `+${delta} improving` : delta < 0 ? `${delta} declining` : "Stable",
                sc: delta > 0 ? "#0F6E56" : delta < 0 ? "#993C1D" : "var(--color-text-tertiary, #999)",
              },
              {
                lb: "Best rank (18mo)", v: best ? `#${best}` : "—",
                sub: best && cur ? `${cur - best} off peak` : null,
                sc: "var(--color-text-secondary, #666)",
              },
              {
                lb: "Matches (18mo)", v: tot,
                sub: `${w}W · ${l}L`,
                sc: "var(--color-text-secondary, #666)",
              },
              {
                lb: "Win rate", v: `${wr}%`,
                sub: wr >= 60 ? "Strong form" : wr >= 45 ? "Competitive" : tot > 0 ? "Developing" : "—",
                sc: wr >= 60 ? "#0F6E56" : wr >= 45 ? "#854F0B" : "#993C1D",
              },
            ].map((c, i) => (
              <div key={i} style={cardStyle}>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary, #999)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  {c.lb}
                </div>
                <div style={{ fontSize: 26, fontWeight: 500, fontFamily: "var(--font-mono, monospace)", lineHeight: 1.1 }}>
                  {c.v}
                </div>
                {c.sub && (
                  <div style={{ fontSize: 12, marginTop: 5, color: c.sc }}>{c.sub}</div>
                )}
              </div>
            ))}
          </div>

          <div style={{ ...cardStyle, padding: "16px 16px 12px", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>
              World ranking trajectory
            </div>
            {rk.length > 0 ? (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={rk} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary, #eee)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #999)" }}
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
                    }}
                    interval={Math.max(1, Math.floor(rk.length / 7))}
                  />
                  <YAxis
                    reversed
                    domain={[Math.max(1, Math.min(...ranks) - 10), Math.max(...ranks) + 10]}
                    tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #999)" }}
                    tickFormatter={(v) => `#${v}`}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-background-primary, #fff)",
                      border: "1px solid var(--color-border-secondary, #ddd)",
                      borderRadius: 10, fontSize: 13,
                    }}
                    labelFormatter={(v) =>
                      new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
                    }
                    formatter={(v) => [`#${v}`, "World rank"]}
                  />
                  <ReferenceLine y={cur} stroke="#534AB7" strokeDasharray="4 4" strokeOpacity={0.3} />
                  <Line
                    type="monotone" dataKey="rank" stroke="#534AB7" strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5, fill: "#534AB7", stroke: "#fff", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary, #999)" }}>
                No ranking data available
              </div>
            )}
          </div>

          <div style={{ borderRadius: "var(--border-radius-lg, 12px)", border: "1px solid var(--color-border-tertiary, #e5e5e5)", overflow: "hidden", background: "var(--color-background-primary, #fff)" }}>
            <div style={{ fontSize: 14, fontWeight: 500, padding: "14px 16px 10px" }}>
              Recent matches
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "40px 1fr 120px 52px",
              padding: "6px 16px", gap: 8,
              fontSize: 11, color: "var(--color-text-tertiary, #999)",
              textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              <span></span><span>Opponent</span><span>Event</span><span style={{ textAlign: "right" }}>Score</span>
            </div>
            {ml.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "grid", gridTemplateColumns: "40px 1fr 120px 52px",
                  alignItems: "center", padding: "10px 16px",
                  borderTop: "1px solid var(--color-border-tertiary, #f0f0f0)",
                  gap: 8, fontSize: 13,
                }}
              >
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: m.r === "W" ? "#E1F5EE" : "#FAECE7",
                    color: m.r === "W" ? "#085041" : "#712B13",
                  }}
                >
                  {m.r}
                </span>
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {m.o}{" "}
                    <span style={{ color: "var(--color-text-tertiary, #aaa)", fontWeight: 400 }}>
                      {m.on}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary, #aaa)", marginTop: 2 }}>
                    {m.rp}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12 }}>{m.e}</div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    <span style={{ color: "var(--color-text-tertiary, #aaa)" }}>{m.d}</span>{" "}
                    <span style={{ color: TIER_COLORS[m.t], fontWeight: 600 }}>
                      G{m.t}
                    </span>
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, textAlign: "right" }}>
                  {m.s}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
