import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";

// =========================
// ENV + SUPABASE
// =========================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("SUPABASE_URL:", SUPABASE_URL);
console.log("URL OK?", !!SUPABASE_URL);
console.log("ANON OK?", !!SUPABASE_ANON);

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn(
    "⚠️ Variáveis do Supabase ausentes. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// =========================
// BRANDING
// =========================
const BRAND = {
  orange: "#E7622D",
  black: "#1C1C1C",
  gray: "#4E4E50",
  beige: "#CABFAD",
  white: "#FFFFFF",
};

const COMPANY = {
  whatsapp: "(31) 98762-3965",
  email: "contatolavapro@gmail.com",
  address_short: "Atendimento em domicílio — BH e RMBH",
  instagram: "@lavaprofix",
  facebook: "fb.com/lavaprofix",
  site: "lavaprofix.com.br",
  logoPath: "/lavaprofix-logo.png",
};

// =========================
// ASSETS PDF (logo + selo + assinatura)
// =========================
const PDF_ASSETS = {
  logo: COMPANY.logoPath,
  seal: "/selo_garantia_premium.png",
  signature: "/Navy and Grey Digital Marketing Email Signature.png",
};

// =========================
// IMAGE LOADER + CACHE
// =========================
async function loadImageAsDataURL(path) {
  const res = await fetch(path, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Falha ao carregar imagem: ${path} (HTTP ${res.status})`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let LOGO_DATAURL_CACHE = null;
let SEAL_DATAURL_CACHE = null;
let SIGNATURE_DATAURL_CACHE = null;

async function getLogoDataUrlSafe() {
  if (LOGO_DATAURL_CACHE) return LOGO_DATAURL_CACHE;
  try {
    const d = await loadImageAsDataURL(PDF_ASSETS.logo);
    LOGO_DATAURL_CACHE = d;
    return d;
  } catch (e) {
    console.warn("Logo não carregou. Seguindo sem logo.", e);
    return null;
  }
}

async function getSealDataUrlSafe() {
  if (SEAL_DATAURL_CACHE) return SEAL_DATAURL_CACHE;
  try {
    const d = await loadImageAsDataURL(PDF_ASSETS.seal);
    SEAL_DATAURL_CACHE = d;
    return d;
  } catch (e) {
    console.warn("Selo não carregou. Seguindo sem selo.", e);
    return null;
  }
}

async function getSignatureDataUrlSafe() {
  if (SIGNATURE_DATAURL_CACHE) return SIGNATURE_DATAURL_CACHE;
  try {
    const d = await loadImageAsDataURL(PDF_ASSETS.signature);
    SIGNATURE_DATAURL_CACHE = d;
    return d;
  } catch (e) {
    console.warn("Assinatura não carregou. Seguindo sem assinatura.", e);
    return null;
  }
}

// Adiciona imagem sem distorcer (contain)
function addImageContain(doc, dataUrl, x, y, boxW, boxH, type = "PNG") {
  const props = doc.getImageProperties(dataUrl);
  const imgW = props.width || 1;
  const imgH = props.height || 1;

  const scale = Math.min(boxW / imgW, boxH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;

  const dx = x + (boxW - drawW) / 2;
  const dy = y + (boxH - drawH) / 2;

  doc.addImage(dataUrl, type, dx, dy, drawW, drawH);
  return { dx, dy, drawW, drawH };
}

// =========================
// ENUMS (O QUE SEU BANCO USA)
// =========================
const EQUIPMENT_TYPE = {
  TOP_LOAD: "MAQUINA_DE_LAVAR_TOP_LOAD",
  LAVA_E_SECA: "LAVA_E_SECA_FRONTAL",
  RESIDENCIAL: "SERVICOS_RESIDENCIAIS",
};

// parts_catalog.equipment_scope tem valores antigos + novos.
// Normaliza o match aqui.
function scopeMatchesEquipment(scope, equipmentType) {
  const s = String(scope || "").toUpperCase();

  if (s === "AMBOS" || s === "TODOS" || s === "ALL") return true;

  if (equipmentType === EQUIPMENT_TYPE.TOP_LOAD) {
    return s === "TOP_LOAD" || s === "MAQUINA_DE_LAVAR_TOP_LOAD";
  }

  if (equipmentType === EQUIPMENT_TYPE.LAVA_E_SECA) {
    return s === "LAVA_E_SECA" || s === "LAVA_E_SECA_FRONTAL";
  }

  if (equipmentType === EQUIPMENT_TYPE.RESIDENCIAL) {
    return s === "SERVICOS_RESIDENCIAIS";
  }

  return false;
}

// =========================
// HELPERS
// =========================
const brl = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const onlyDigits = (s = "") => String(s || "").replace(/\D+/g, "");
const nowISODate = () => new Date().toISOString().slice(0, 10);
const safeText = (s) => String(s || "").trim();

function el(sel) {
  return document.querySelector(sel);
}

// =========================
// STATE
// =========================
const STATE = {
  session: null,
  config: {
    CUSTO_FIXO_ATENDIMENTO_PADRAO: 65.3,
    VALOR_DIAGNOSTICO_TOPLOAD: 190,
    VALOR_DIAGNOSTICO_LAVASECA: 230,
    TAXA_CARTAO: 0.05,
    DESCONTO_PIX: 0.05,
    KM_FRANQUIA: 10,
    CUSTO_DESLOCAMENTO_EXTRA_FORNECEDOR_PADRAO: 40,
  },

  equipment: null,
  search: "",
  services: [],
  partsCatalog: [],
  manualServices: [], // { id, name, labor_base_cents, warranty_days }
  manualParts: [],    // { id, part_name, cost_real_cents, margin_percent, needs_supplier_pickup }


  selectedServiceIds: new Set(),
  selectedParts: [],

  manualServices: [], // [{ id, name, labor_cents, warranty_days }]
  manualParts: [],    // [{ id, part_name, cost_real_cents, margin_percent, needs_supplier_pickup }]


  client_name: "",
  client_phone: "",
  client_address: "",
  machine_brand: "",
  machine_model: "",
  notes: "",

  supplier_logistics_override_cents: null, // null = automático, 0 = remove, >0 = forçar
  viewMode: "TECH", // TECH | CLIENT
};

let COMBO_STATE = { discountPct: 0, discountedCard: null };

// =========================
// UI
// =========================
const app = el("#app");
if (!app) throw new Error("Elemento #app não encontrado.");

app.innerHTML = `
  <div class="wrap">
    <header class="topbar">
      <div class="brand">
        <div class="dot"></div>
        <div>
          <div class="title">LavaProFix OS</div>
          <div class="subtitle">Orçamento • Serviços • Peças • WhatsApp • PDF</div>
        </div>
      </div>
      <div class="right">
        <button id="btnModeTech" class="chip chipActive">Modo Técnico</button>
        <button id="btnModeClient" class="chip">Modo Cliente</button>
      </div>
    </header>

    <section class="card">
      <div class="label">Acesso (opcional)</div>
      <div class="row">
        <input id="email" class="input" placeholder="email" />
        <input id="password" class="input" type="password" placeholder="senha" />
        <button id="login" class="btn btnOrange">Entrar</button>
      </div>
      <div id="status" class="hint"></div>
    </section>

    <section class="card">
      <div class="label">1) Escolha o tipo</div>
      <div class="row">
        <button id="eqTop" class="btn">Máquinas de Lavar</button>
        <button id="eqFront" class="btn">Lava e Seca</button>
        <button id="eqRes" class="btn">Serviços Residenciais</button>
      </div>
      <div id="eqHint" class="hint">Selecione uma opção para carregar os serviços e peças.</div>
    </section>

    <section class="grid2">
      <div class="card">
        <div class="row between">
          <div>
            <div class="label">2) Serviços</div>
            <div class="hint">Marque múltiplos serviços. Diagnóstico fica grátis quando o orçamento é aprovado (tem serviço).</div>
          </div>
          <div class="row" style="gap:8px;">
            <input id="search" class="input" placeholder="Buscar (ex: bomba, vazamento, torneira)..." />
            <button id="clearSel" class="btn">Limpar</button>
          </div>
        </div>
        <div class="divider"></div>
<div class="label">Serviço manual</div>
<div class="hint">Use quando o serviço não estiver no catálogo.</div>

<div class="row">
  <input id="manualServiceName" class="input" placeholder="Nome do serviço (ex: troca de mangueira)" />
  <input id="manualServiceValue" class="input" placeholder="Valor mão de obra (R$)" style="max-width:220px;" />
  <input id="manualServiceWarranty" class="input" placeholder="Garantia (dias)" style="max-width:160px;" />
  <button id="addManualService" class="btn btnOrange">Adicionar</button>
</div>

<div id="manualServicesList" class="list"></div>

        <div id="servicesWrap" class="servicesWrap">
          <div class="hint">Escolha um tipo (acima) para exibir serviços.</div>
        </div>
      </div>

      <div class="card">
        <div class="label">3) Peças</div>
        <div class="hint">Margem fixa (30% ou 40%). Cliente não vê margem/custo.</div>

        <div class="row">
          <select id="partSelect" class="input">
            <option value="">— Selecione uma peça —</option>
          </select>

          <select id="marginSelect" class="input" style="max-width:160px;">
            <option value="30">Margem 30%</option>
            <option value="40" selected>Margem 40%</option>
          </select>

          <button id="addPart" class="btn btnOrange">Adicionar</button>
        </div>
        <div class="divider"></div>
<div class="label">Peça manual</div>
<div class="hint">Use quando a peça não estiver cadastrada no Supabase.</div>

<div class="row">
  <input id="manualPartName" class="input" placeholder="Nome da peça (ex: atuador freio)" />
  <input id="manualPartCost" class="input" placeholder="Custo (R$)" style="max-width:180px;" />
  <select id="manualPartMargin" class="input" style="max-width:160px;">
    <option value="30">Margem 30%</option>
    <option value="40" selected>Margem 40%</option>
  </select>
  <button id="addManualPart" class="btn btnOrange">Adicionar</button>
</div>

<div id="manualPartsList" class="list"></div>

        <div id="partsList" class="list"></div>

        <div class="divider"></div>

        <div class="label">Logística fornecedor</div>
        <div class="hint">Automático se alguma peça exigir fornecedor (ou você pode forçar).</div>
        <div class="row">
          <button id="applySupplierLog" class="btn">Forçar logística padrão</button>
          <button id="removeSupplierLog" class="btn">Remover logística</button>
          <button id="autoSupplierLog" class="btn">Voltar p/ automático</button>
        </div>
      </div>
    </section>


    <section class="card">
      <div class="row between">
        <div>
          <div class="label">4) Dados da OS</div>
          <div class="hint">Entra no PDF e na mensagem.</div>
        </div>
        <div class="row" style="gap:8px;">
          <button id="saveDraft" class="btn">Salvar rascunho</button>
          <button id="loadDraft" class="btn">Carregar rascunho</button>
          <button id="newOS" class="btn">Nova OS</button>
        </div>
      </div>

      <div class="gridForm">
        <input id="clientName" class="input" placeholder="Nome completo do cliente" />
        <input id="clientPhone" class="input" placeholder="Telefone (WhatsApp)" />
        <input id="clientAddress" class="input" placeholder="Endereço (opcional)" />

        <input id="brand" class="input" placeholder="Marca (opcional)" />
        <input id="model" class="input" placeholder="Modelo (opcional)" />

        <textarea id="notes" class="input" rows="2" placeholder="Observações (opcional)"></textarea>
      </div>
    </section>

    <section class="grid2">
      <div class="card">
        <div class="label">5) Resumo (Cliente)</div>
        <div id="summaryClient" class="summary"></div>

        <div class="row" style="margin-top:10px;">
          <button id="copyClientMsg" class="btn btnOrange">Copiar mensagem p/ cliente</button>
          <button id="openWhats" class="btn">Abrir WhatsApp</button>
        </div>

        <div class="hint" style="margin-top:8px;">
          Cliente não recebe margem, custo, lucro, taxa do cartão ou logística interna detalhada.
        </div>
      </div>

      <div class="card">
        <div class="label">Resumo (Técnico)</div>
        <div id="summaryTech" class="summary"></div>

        <div class="row" style="margin-top:10px;">
          <button id="suggestCombo" class="btn">Sugerir combo seguro</button>
          <button id="applyCombo" class="btn" disabled>Aplicar combo</button>
          <button id="saveOSDb" class="btn btnOrange">Salvar OS no Supabase</button>
        </div>

        <div id="comboHint" class="hint" style="margin-top:10px;"></div>
      </div>
    </section>

    <section class="card">
      <div class="label">6) Certificado de garantia (PDF)</div>
      <div class="hint">Gera PDF A4 com data automática. Higienização pode ficar sem garantia (0 dias).</div>
      <div class="row">
        <button id="genPDF" class="btn btnOrange">Gerar PDF</button>
      </div>
    </section>

    <footer class="foot">
      <div class="hint">Dica: escolha o tipo primeiro. Depois busque e marque os serviços.</div>
    </footer>
  </div>
`;

// =========================
// CSS
// =========================
const style = document.createElement("style");
style.textContent = `
  *{box-sizing:border-box}
  body{margin:0;background:#f6f6f7;color:${BRAND.black};font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}
  .wrap{max-width:1180px;margin:0 auto;padding:14px;display:grid;gap:12px}
  .topbar{display:flex;align-items:center;justify-content:space-between;background:${BRAND.white};border:1px solid #eee;border-radius:14px;padding:12px}
  .brand{display:flex;align-items:center;gap:10px}
  .dot{width:14px;height:14px;border-radius:50%;background:${BRAND.orange}}
  .title{font-weight:900;letter-spacing:.2px}
  .subtitle{font-size:12px;color:${BRAND.gray}}
  .card{background:${BRAND.white};border:1px solid #eee;border-radius:14px;padding:12px}
  .grid2{display:grid;grid-template-columns:1fr;gap:12px}
  @media(min-width:980px){.grid2{grid-template-columns:1fr 1fr}}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .between{justify-content:space-between}
  .label{font-weight:900;margin-bottom:6px}
  .hint{font-size:12px;color:${BRAND.gray}}
  .input{width:100%;max-width:420px;padding:10px;border:1px solid #ddd;border-radius:12px;outline:none}
  textarea.input{max-width:none}
  .btn{padding:10px 12px;border:1px solid #ddd;border-radius:12px;background:#fff;cursor:pointer;font-weight:800}
  .btn:hover{border-color:#cfcfcf}
  .btnOrange{background:${BRAND.orange};border-color:${BRAND.orange};color:#fff}
  .chip{padding:8px 10px;border:1px solid #ddd;border-radius:999px;background:#fff;cursor:pointer;font-weight:900;font-size:12px}
  .chipActive{border-color:${BRAND.orange};color:${BRAND.orange}}
  .servicesWrap{margin-top:10px;display:grid;gap:10px}
  details{border:1px solid #efefef;border-radius:12px;padding:8px 10px;background:#fff}
  summary{cursor:pointer;font-weight:900}
  .svcItem{display:flex;gap:10px;align-items:flex-start;padding:8px;border-top:1px dashed #f0f0f0}
  .svcItem:first-of-type{border-top:none}
  .svcMeta{flex:1}
  .svcName{font-weight:900}
  .svcSub{font-size:12px;color:${BRAND.gray}}
  .price{font-weight:1000}
  .list{margin-top:10px;display:grid;gap:8px}
  .pill{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px;border:1px solid #eee;border-radius:12px}
  .divider{height:1px;background:#eee;margin:12px 0}
  .gridForm{display:grid;grid-template-columns:1fr;gap:10px}
  @media(min-width:980px){.gridForm{grid-template-columns:repeat(3, 1fr)}}
  .summary{border:1px solid #eee;border-radius:12px;padding:10px;min-height:110px;background:#fcfcfc}
  .foot{padding:8px;text-align:center}
  #genPDF{position:relative;z-index:9999;pointer-events:auto}
`;
document.head.appendChild(style);

// =========================
// CONFIG
// =========================
async function loadConfig() {
  const { data, error } = await supabase.from("app_config").select("key, value_numeric, value_text");
  if (error) {
    console.warn("Config load error:", error.message);
    return;
  }

  const map = {};
  for (const row of data || []) {
    if (row.value_numeric !== null && row.value_numeric !== undefined) map[row.key] = Number(row.value_numeric);
    if (row.value_text) map[row.key] = row.value_text;
  }

  STATE.config = { ...STATE.config, ...map };
  console.log("CONFIG carregada:", STATE.config);
}

// =========================
// AUTH
// =========================
const statusEl = el("#status");

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  STATE.session = data.session || null;

  if (STATE.session) {
    statusEl.textContent = `Usuário conectado: ${STATE.session.user.email}`;
    statusEl.style.color = "green";
  } else {
    statusEl.textContent = "Sem login (ok).";
    statusEl.style.color = BRAND.gray;
  }
}

el("#login").addEventListener("click", async () => {
  const email = safeText(el("#email").value);
  const password = safeText(el("#password").value);

  if (!email || !password) {
    statusEl.textContent = "Preencha email e senha.";
    statusEl.style.color = "red";
    return;
  }

  statusEl.textContent = "Tentando logar...";
  statusEl.style.color = BRAND.gray;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    statusEl.textContent = `Erro no login: ${error.message}`;
    statusEl.style.color = "red";
    return;
  }

  statusEl.textContent = `Login realizado: ${data.user.email}`;
  statusEl.style.color = "green";
  await refreshSession();
});

// =========================
// MODE
// =========================
function setMode(mode) {
  STATE.viewMode = mode;
  el("#btnModeTech").classList.toggle("chipActive", mode === "TECH");
  el("#btnModeClient").classList.toggle("chipActive", mode === "CLIENT");
  renderSummaries();
}

el("#btnModeTech").addEventListener("click", () => setMode("TECH"));
el("#btnModeClient").addEventListener("click", () => setMode("CLIENT"));

// =========================
// EQUIPMENT SELECT
// =========================
function equipmentLabel(eq) {
  if (eq === EQUIPMENT_TYPE.TOP_LOAD) return "Máquina de Lavar";
  if (eq === EQUIPMENT_TYPE.LAVA_E_SECA) return "Lava e Seca";
  return "Serviços Residenciais";
}

async function setEquipment(eq) {
  STATE.equipment = eq;

  el("#eqTop").classList.toggle("btnOrange", eq === EQUIPMENT_TYPE.TOP_LOAD);
  el("#eqFront").classList.toggle("btnOrange", eq === EQUIPMENT_TYPE.LAVA_E_SECA);
  el("#eqRes").classList.toggle("btnOrange", eq === EQUIPMENT_TYPE.RESIDENCIAL);

  el("#eqHint").textContent = `Catálogo filtrado: ${equipmentLabel(eq)}`;

  STATE.selectedServiceIds = new Set();
  STATE.selectedParts = [];
  STATE.search = "";
  el("#search").value = "";
  COMBO_STATE = { discountPct: 0, discountedCard: null };
  el("#comboHint").textContent = "";
  el("#applyCombo").disabled = true;

  await reloadAll();
}

el("#eqTop").addEventListener("click", async () => setEquipment(EQUIPMENT_TYPE.TOP_LOAD));
el("#eqFront").addEventListener("click", async () => setEquipment(EQUIPMENT_TYPE.LAVA_E_SECA));
el("#eqRes").addEventListener("click", async () => setEquipment(EQUIPMENT_TYPE.RESIDENCIAL));

// =========================
// FETCH
// =========================
async function fetchServices() {
  if (!STATE.equipment) return;

  const { data, error } = await supabase
    .from("service_catalog")
    .select("id, name, equipment_type, category, labor_base_cents, warranty_days, notes, avg_time_min, complexity, tags, active")
    .eq("active", true)
    .eq("equipment_type", STATE.equipment)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchServices:", error);
    el("#servicesWrap").innerHTML = `<div class="hint" style="color:red;">Erro ao carregar serviços: ${error.message}</div>`;
    return;
  }

  STATE.services = data || [];
}

async function fetchPartsCatalog() {
  const { data, error } = await supabase
    .from("parts_catalog")
    .select("id, name, equipment_scope, default_cost_cents, default_margin_percent, always_in_stock, requires_supplier_logistics, active")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("fetchPartsCatalog:", error);
    return;
  }
  STATE.partsCatalog = data || [];
}

function populatePartsSelect() {
  const select = el("#partSelect");
  if (!select) return;

  select.innerHTML = `<option value="">— Selecione uma peça —</option>`;
  if (!STATE.equipment) return;

  const filtered = (STATE.partsCatalog || []).filter((p) => scopeMatchesEquipment(p.equipment_scope, STATE.equipment));
  for (const p of filtered) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} • sugestão ${brl(p.default_cost_cents)}`;
    select.appendChild(opt);
  }
}

// =========================
// SERVICES UI
// =========================
el("#search").addEventListener("input", (e) => {
  STATE.search = e.target.value || "";
  renderServiceList();
});

el("#clearSel").addEventListener("click", () => {
  STATE.selectedServiceIds = new Set();
  COMBO_STATE = { discountPct: 0, discountedCard: null };
  el("#comboHint").textContent = "";
  el("#applyCombo").disabled = true;
  renderServiceList();
  renderSummaries();
});

function groupByCategory(list) {
  const map = new Map();
  for (const s of list) {
    const c = s.category || "OUTROS";
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(s);
  }
  return map;
}

// heurística p/ detectar serviço de diagnóstico se existir no catálogo
function isDiagnosticService(s) {
  const id = String(s?.id || "").toLowerCase();
  const name = String(s?.name || "").toLowerCase();
  return id.includes("diagnost") || name.includes("diagnóst") || name.includes("diagnost");
}

function renderServiceList() {
  const wrap = el("#servicesWrap");
  if (!wrap) return;

  if (!STATE.equipment) {
    wrap.innerHTML = `<div class="hint">Escolha um tipo (acima) para exibir serviços.</div>`;
    return;
  }

  let list = STATE.services || [];
  const q = safeText(STATE.search).toLowerCase();

  if (q) {
    list = list.filter((s) => {
      const tags = Array.isArray(s.tags) ? s.tags.join(" ") : String(s.tags || "");
      const text = `${s.name} ${s.category} ${tags} ${s.notes || ""}`.toLowerCase();
      return text.includes(q);
    });
  }

  if (!list.length) {
    wrap.innerHTML = `<div class="hint">Nenhum serviço encontrado para este filtro.</div>`;
    return;
  }

  const grouped = groupByCategory(list);
  const cats = Array.from(grouped.keys()).sort();

  wrap.innerHTML = cats
    .map((cat) => {
      const items = grouped.get(cat);

      const htmlItems = items
        .map((s) => {
          const checked = STATE.selectedServiceIds.has(s.id) ? "checked" : "";
          const warranty = Number(s.warranty_days || 0);
          const warrantyText = warranty > 0 ? `Garantia ${warranty} dias` : "Sem garantia";

          return `
            <label class="svcItem">
              <input type="checkbox" data-id="${s.id}" ${checked} />
              <div class="svcMeta">
                <div style="display:flex;justify-content:space-between;gap:10px;">
                  <div class="svcName">${s.name}</div>
                  <div class="price">${brl(s.labor_base_cents || 0)}</div>
                </div>
                <div class="svcSub">
                  ${warrantyText}
                  ${s.notes ? " • " + s.notes : ""}
                  ${isDiagnosticService(s) ? " • (diagnóstico)" : ""}
                </div>
              </div>
            </label>
          `;
        })
        .join("");

      return `
        <details open>
          <summary>${cat}</summary>
          <div>${htmlItems}</div>
        </details>
      `;
    })
    .join("");

  wrap.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      if (e.target.checked) STATE.selectedServiceIds.add(id);
      else STATE.selectedServiceIds.delete(id);

      COMBO_STATE = { discountPct: 0, discountedCard: null };
      el("#comboHint").textContent = "";
      el("#applyCombo").disabled = true;

      renderSummaries();
    });
  });
}

// =========================
// PARTS UI
// =========================
el("#addPart").addEventListener("click", () => {
  const partId = el("#partSelect").value;
  if (!partId) return;

  const part = STATE.partsCatalog.find((p) => p.id === partId);
  if (!part) return;

  const margin = Number(el("#marginSelect").value || 40);
  const cost = Number(part.default_cost_cents || 0);

  STATE.selectedParts.push({
    part_id: part.id,
    part_name: part.name,
    cost_real_cents: cost,
    margin_percent: margin,
    needs_supplier_pickup: !part.always_in_stock && !!part.requires_supplier_logistics,
  });

  renderParts();
  renderSummaries();
});

function calcPartSaleCents(p) {
  const cost = Number(p.cost_real_cents || 0);
  const m = Number(p.margin_percent || 0);
  return Math.round(cost * (1 + m / 100));
}

function renderParts() {
  const list = el("#partsList");
  if (!list) return;

  if (!STATE.selectedParts.length) {
    list.innerHTML = `<div class="hint">Nenhuma peça adicionada.</div>`;
    return;
  }

  list.innerHTML = STATE.selectedParts
    .map((p, idx) => {
      return `
        <div class="pill">
          <div>
            <div style="font-weight:1000;">${p.part_name}</div>
            <div class="hint">Venda: <b>${brl(calcPartSaleCents(p))}</b> ${
              p.needs_supplier_pickup ? " • Fornecedor" : ""
            }</div>
            <div class="hint" style="opacity:.85;">(interno) custo: ${brl(p.cost_real_cents)} • margem: ${p.margin_percent}%</div>
          </div>
          <div class="row" style="gap:6px;">
            <button class="btn" data-act="toggleSupplier" data-i="${idx}">
              ${p.needs_supplier_pickup ? "Fornecedor: SIM" : "Fornecedor: NÃO"}
            </button>
            <button class="btn" data-act="removePart" data-i="${idx}">Remover</button>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", (e) => {
      const act = e.target.getAttribute("data-act");
      const i = Number(e.target.getAttribute("data-i"));

      if (act === "removePart") {
        STATE.selectedParts.splice(i, 1);
        renderParts();
        renderSummaries();
      }

      if (act === "toggleSupplier") {
        STATE.selectedParts[i].needs_supplier_pickup = !STATE.selectedParts[i].needs_supplier_pickup;
        renderParts();
        renderSummaries();
      }
    });
  });
}

el("#applySupplierLog").addEventListener("click", () => {
  STATE.supplier_logistics_override_cents = Math.round(
    Number(STATE.config.CUSTO_DESLOCAMENTO_EXTRA_FORNECEDOR_PADRAO || 40) * 100
  );
  renderSummaries();
});

el("#removeSupplierLog").addEventListener("click", () => {
  STATE.supplier_logistics_override_cents = 0;
  renderSummaries();
});

el("#autoSupplierLog").addEventListener("click", () => {
  STATE.supplier_logistics_override_cents = null;
  renderSummaries();
});

// =========================
// MANUAL SERVICES / PARTS
// =========================
function parseBRLToCents(val) {
  const s = String(val || "").replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

// ---- Manual Service
function renderManualServices() {
  const box = el("#manualServicesList");
  if (!box) return;

  if (!STATE.manualServices.length) {
    box.innerHTML = `<div class="hint">Nenhum serviço manual.</div>`;
    return;
  }

  box.innerHTML = STATE.manualServices
    .map((s, i) => `
      <div class="pill">
        <div>
          <div style="font-weight:1000;">${s.name}</div>
          <div class="hint">Mão de obra: <b>${brl(s.labor_cents)}</b> • Garantia: ${s.warranty_days || 0} dias</div>
        </div>
        <button class="btn" data-act="rmManualService" data-i="${i}">Remover</button>
      </div>
    `)
    .join("");

  box.querySelectorAll("button[data-act=rmManualService]").forEach((b) => {
    b.addEventListener("click", (e) => {
      const i = Number(e.target.getAttribute("data-i"));
      STATE.manualServices.splice(i, 1);
      renderManualServices();
      renderSummaries();
    });
  });
}

el("#addManualService")?.addEventListener("click", () => {
  const name = safeText(el("#manualServiceName")?.value);
  const cents = parseBRLToCents(el("#manualServiceValue")?.value);
  const wd = Number(el("#manualServiceWarranty")?.value || 0);

  if (!name) return alert("Digite o nome do serviço manual.");
  if (!cents) return alert("Digite um valor válido (R$).");

  STATE.manualServices.push({
    id: uid("ms"),
    name,
    labor_cents: cents,
    warranty_days: Math.max(0, wd || 0),
  });

  el("#manualServiceName").value = "";
  el("#manualServiceValue").value = "";
  el("#manualServiceWarranty").value = "";

  renderManualServices();
  renderSummaries();
});

// ---- Manual Part
function renderManualParts() {
  const box = el("#manualPartsList");
  if (!box) return;

  if (!STATE.manualParts.length) {
    box.innerHTML = `<div class="hint">Nenhuma peça manual.</div>`;
    return;
  }

  box.innerHTML = STATE.manualParts
    .map((p, i) => `
      <div class="pill">
        <div>
          <div style="font-weight:1000;">${p.part_name}</div>
          <div class="hint">Venda: <b>${brl(calcPartSaleCents(p))}</b> ${p.needs_supplier_pickup ? " • Fornecedor" : ""}</div>
          <div class="hint" style="opacity:.85;">(interno) custo: ${brl(p.cost_real_cents)} • margem: ${p.margin_percent}%</div>
        </div>
        <div class="row" style="gap:6px;">
          <button class="btn" data-act="toggleManualSupplier" data-i="${i}">
            ${p.needs_supplier_pickup ? "Fornecedor: SIM" : "Fornecedor: NÃO"}
          </button>
          <button class="btn" data-act="rmManualPart" data-i="${i}">Remover</button>
        </div>
      </div>
    `)
    .join("");

  box.querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", (e) => {
      const act = e.target.getAttribute("data-act");
      const i = Number(e.target.getAttribute("data-i"));

      if (act === "rmManualPart") {
        STATE.manualParts.splice(i, 1);
        renderManualParts();
        renderSummaries();
      }

      if (act === "toggleManualSupplier") {
        STATE.manualParts[i].needs_supplier_pickup = !STATE.manualParts[i].needs_supplier_pickup;
        renderManualParts();
        renderSummaries();
      }
    });
  });
}

el("#addManualPart")?.addEventListener("click", () => {
  const name = safeText(el("#manualPartName")?.value);
  const cost = parseBRLToCents(el("#manualPartCost")?.value);
  const margin = Number(el("#manualPartMargin")?.value || 40);

  if (!name) return alert("Digite o nome da peça manual.");
  if (!cost) return alert("Digite um custo válido (R$).");

  STATE.manualParts.push({
    id: uid("mp"),
    part_id: null,
    part_name: name,
    cost_real_cents: cost,
    margin_percent: margin,
    needs_supplier_pickup: false,
  });

  el("#manualPartName").value = "";
  el("#manualPartCost").value = "";

  renderManualParts();
  renderSummaries();
});

// =========================
// OS INPUTS
// =========================
el("#clientName").addEventListener("input", (e) => (STATE.client_name = e.target.value || ""));
el("#clientPhone").addEventListener("input", (e) => (STATE.client_phone = e.target.value || ""));
el("#clientAddress").addEventListener("input", (e) => (STATE.client_address = e.target.value || ""));
el("#brand").addEventListener("input", (e) => (STATE.machine_brand = e.target.value || ""));
el("#model").addEventListener("input", (e) => (STATE.machine_model = e.target.value || ""));
el("#notes").addEventListener("input", (e) => (STATE.notes = e.target.value || ""));

// =========================
// MOTOR (Diagnóstico grátis quando aprovado)
// =========================
function getSelectedServices() {
  const ids = STATE.selectedServiceIds;
  return (STATE.services || []).filter((s) => ids.has(s.id));
}

function getDiagnosisValueCents() {
  if (STATE.equipment === EQUIPMENT_TYPE.TOP_LOAD)
    return Math.round(Number(STATE.config.VALOR_DIAGNOSTICO_TOPLOAD || 190) * 100);
  if (STATE.equipment === EQUIPMENT_TYPE.LAVA_E_SECA)
    return Math.round(Number(STATE.config.VALOR_DIAGNOSTICO_LAVASECA || 230) * 100);
  return 0;
}

function calcLogisticsCents() {
  if (STATE.supplier_logistics_override_cents !== null)
    return Number(STATE.supplier_logistics_override_cents || 0);

  const needs = [...(STATE.selectedParts || []), ...(STATE.manualParts || [])]
  .some((p) => p.needs_supplier_pickup === true);

  if (!needs) return 0;

  return Math.round(Number(STATE.config.CUSTO_DESLOCAMENTO_EXTRA_FORNECEDOR_PADRAO || 40) * 100);
}

function computeTotals() {
  const selectedServices = getSelectedServices();
  const manualServices = STATE.manualServices || [];

  const diagValue = getDiagnosisValueCents();

  const diagSelected = selectedServices.some((s) => isDiagnosticService(s));
  const nonDiagServices = selectedServices.filter((s) => !isDiagnosticService(s));
  const allNonDiag = [...nonDiagServices, ...manualServices];


  const onlyDiagSelected = diagSelected && nonDiagServices.length === 0;

  const labor = onlyDiagSelected
    ? diagValue
    : allNonDiag.reduce((sum, s) => sum + Number(s.labor_base_cents || s.labor_cents || 0), 0);


  const allParts = [...(STATE.selectedParts || []), ...(STATE.manualParts || [])];

  const partsSale = allParts.reduce((sum, p) => sum + calcPartSaleCents(p), 0);
  const partsCost = allParts.reduce((sum, p) => sum + Number(p.cost_real_cents || 0), 0);


  const logistics = calcLogisticsCents();

  const isMachineType =
    STATE.equipment === EQUIPMENT_TYPE.TOP_LOAD || STATE.equipment === EQUIPMENT_TYPE.LAVA_E_SECA;

  const diagnosisIncludedFree = isMachineType && allNonDiag.length >= 1;


  const card = Math.max(0, labor + partsSale + logistics);

  const pixDiscountPct = Number(STATE.config.DESCONTO_PIX || 0.05);
  const pix = Math.round(card * (1 - pixDiscountPct));

  const feePct = Number(STATE.config.TAXA_CARTAO || 0.05);
  const netCard = Math.round(card * (1 - feePct));

  const fixedCost = Math.round(Number(STATE.config.CUSTO_FIXO_ATENDIMENTO_PADRAO || 65.3) * 100);
  const lucroReal = netCard - partsCost - logistics - fixedCost;

  const warrantyDays = Math.max(
  ...selectedServices.map((s) => Number(s.warranty_days || 0)),
  ...manualServices.map((s) => Number(s.warranty_days || 0)),
  0
);


  return {
    selectedServices,
    nonDiagServices,
    diagSelected,
    onlyDiagSelected,
    diagnosisIncludedFree,
    diagValue,
    labor,
    partsSale,
    partsCost,
    logistics,
    card,
    pix,
    netCard,
    fixedCost,
    lucroReal,
    warrantyDays,
  };
}

// =========================
// COMBO SUGGESTION (TECH)
// =========================
function suggestCombo() {
  const t = computeTotals();
  if (t.card <= 0) return { ok: false, reason: "Selecione serviços/peças primeiro." };

  const baseCard = t.card;
  const minProfit = Math.max(8000, Math.round(0.15 * baseCard));

  for (let d = 10; d >= 1; d -= 0.5) {
    const discounted = Math.round(baseCard * (1 - d / 100));
    const netCard = Math.round(discounted * (1 - Number(STATE.config.TAXA_CARTAO || 0.05)));
    const lucro = netCard - t.partsCost - t.logistics - t.fixedCost;

    if (lucro >= minProfit) {
      return { ok: true, discountPct: d, finalCard: discounted };
    }
  }
  return { ok: false, reason: "Nenhum desconto seguro encontrado." };
}

el("#suggestCombo").addEventListener("click", () => {
  const r = suggestCombo();
  if (!r.ok) {
    COMBO_STATE = { discountPct: 0, discountedCard: null };
    el("#comboHint").textContent = `Combo: ${r.reason}`;
    el("#applyCombo").disabled = true;
    renderSummaries();
    return;
  }

  COMBO_STATE = { discountPct: r.discountPct, discountedCard: r.finalCard };
  el("#comboHint").textContent = `Combo seguro: ${r.discountPct}% (Cartão: ${brl(r.finalCard)})`;
  el("#applyCombo").disabled = false;
});

el("#applyCombo").addEventListener("click", () => {
  if (!COMBO_STATE.discountedCard) return;
  el("#comboHint").textContent = `Combo aplicado: ${COMBO_STATE.discountPct}%`;
  renderSummaries(true);
});

// =========================
// CLIENT MESSAGE
// =========================
function buildClientMessage(t, useCombo = false) {
  const clientName = safeText(STATE.client_name) || "Cliente";
  const eqLabel = equipmentLabel(STATE.equipment);
  
  // ---- Serviços (catálogo + manual)

  const servicesAll = [
  ...(t.selectedServices || []).map((s) => s.name),
  ...(t.manualServices || []).map((s) => s.name),
];

  const servicesTxt = servicesAll.length
    ? servicesAll.map((n) => `• ${n}`).join("\n")
    : "• (nenhum)";


  const partsAll = [
  ...(STATE.selectedParts || []),
  ...(STATE.manualParts || []),
];

  const partsTxt = partsAll.length
    ? `\n\nPeças previstas:\n${partsAll.map((p) => `• ${p.part_name}`).join("\n")}`
    : "";


  const diagTxt = t.diagnosisIncludedFree ? `\n✅ Diagnóstico técnico incluso (orçamento aprovado).` : "";

  const warrantyTxt =
    t.warrantyDays > 0
      ? `\nGarantia: ${t.warrantyDays} dias (mão de obra e peças fornecidas pela LavaProFix).`
      : `\nGarantia: não aplicável para este serviço.`;

  const cardValue = useCombo && COMBO_STATE.discountedCard ? COMBO_STATE.discountedCard : t.card;
  const pixValue = Math.round(cardValue * (1 - Number(STATE.config.DESCONTO_PIX || 0.05)));

  return `Olá, ${clientName}! 👋

✅ Orçamento LavaProFix — ${eqLabel}

Serviços:
${servicesTxt}${partsTxt}

Valor no cartão: ${brl(cardValue)}
Valor no Pix: ${brl(pixValue)}${diagTxt}${warrantyTxt}

Se estiver ok, posso seguir com o serviço agora.`;
}

// =========================
// SUMMARY RENDER
// =========================
function renderSummaries(useCombo = false) {
  const t = computeTotals();

  const clientBox = el("#summaryClient");
  if (clientBox) {
    if (!STATE.equipment) {
      clientBox.innerHTML = `<div class="hint">Selecione o tipo para começar.</div>`;
    } else {
      const msg = buildClientMessage(t, useCombo);
      const cardValue = useCombo && COMBO_STATE.discountedCard ? COMBO_STATE.discountedCard : t.card;
      const pixValue = Math.round(cardValue * (1 - Number(STATE.config.DESCONTO_PIX || 0.05)));

      clientBox.innerHTML = `
        <div><b>Cartão:</b> ${brl(cardValue)}</div>
        <div><b>Pix:</b> ${brl(pixValue)}</div>
        <div class="hint" style="margin-top:8px;white-space:pre-line;">${msg}</div>
      `;
    }
  }

  const techBox = el("#summaryTech");
  if (techBox) {
    if (!STATE.equipment) {
      techBox.innerHTML = `<div class="hint">Selecione o tipo para começar.</div>`;
    } else {
      const cardValue = useCombo && COMBO_STATE.discountedCard ? COMBO_STATE.discountedCard : t.card;
      const pixValue = Math.round(cardValue * (1 - Number(STATE.config.DESCONTO_PIX || 0.05)));
      const netCard = Math.round(cardValue * (1 - Number(STATE.config.TAXA_CARTAO || 0.05)));

      const lucroReal = netCard - t.partsCost - t.logistics - t.fixedCost;

      const lucroWarn =
        lucroReal < 0
          ? `<div style="color:red;font-weight:1000;">⚠ Lucro NEGATIVO</div>
             <div class="hint">O cliente paga menos do que (custo das peças + logística + custo fixo + taxa do cartão).</div>`
          : lucroReal < 8000
          ? `<div style="color:#b45309;font-weight:1000;">⚠ Lucro baixo (abaixo de R$80)</div>`
          : `<div style="color:green;font-weight:1000;">✅ Lucro OK</div>`;

      techBox.innerHTML = `
        ${lucroWarn}
        <div class="divider"></div>
        <div><b>Tipo:</b> ${equipmentLabel(STATE.equipment)}</div>
        <div><b>Serviços selecionados:</b> ${t.selectedServices.length}</div>
        <div><b>Mão de obra:</b> ${brl(t.labor)}</div>
        <div><b>Peças (venda):</b> ${brl(t.partsSale)}</div>
        <div><b>Logística:</b> ${brl(t.logistics)}</div>
        <div><b>Diagnóstico:</b> ${
          t.diagnosisIncludedFree
            ? `INCLUSO (R$ 0)`
            : t.onlyDiagSelected
            ? `Somente diagnóstico: ${brl(t.diagValue)}`
            : `—`
        }</div>
        <div class="divider"></div>
        <div><b>Cartão (cliente paga):</b> ${brl(cardValue)}</div>
        <div><b>Pix (cliente paga):</b> ${brl(pixValue)}</div>
        <div><b>Líquido cartão (após taxa):</b> ${brl(netCard)}</div>
        <div><b>Custo fixo atendimento:</b> ${brl(t.fixedCost)}</div>
        <div class="divider"></div>
        <div><b>Custo real das peças:</b> ${brl(t.partsCost)}</div>
        <div><b>Lucro real estimado:</b> <span style="font-weight:1000;">${brl(lucroReal)}</span></div>
        <div class="hint" style="margin-top:8px;">* Técnico vê isso. Cliente não.</div>
      `;
    }
  }
}

el("#copyClientMsg").addEventListener("click", async () => {
  const t = computeTotals();
  const msg = buildClientMessage(t, !!COMBO_STATE.discountedCard);
  await navigator.clipboard.writeText(msg);
  alert("Mensagem copiada! Agora é só colar no WhatsApp.");
});

el("#openWhats").addEventListener("click", () => {
  const t = computeTotals();
  const msg = buildClientMessage(t, !!COMBO_STATE.discountedCard);
  const phone = onlyDigits(STATE.client_phone);

  const base = phone ? `https://wa.me/55${phone}` : `https://wa.me/?`;
  const url = `${base}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
});

// =========================
// DRAFT SAVE/LOAD
// =========================
function saveDraft() {
  const payload = {
    equipment: STATE.equipment,
    selectedServiceIds: Array.from(STATE.selectedServiceIds),
    selectedParts: STATE.selectedParts,
    client_name: STATE.client_name,
    client_phone: STATE.client_phone,
    client_address: STATE.client_address,
    machine_brand: STATE.machine_brand,
    machine_model: STATE.machine_model,
    notes: STATE.notes,
    supplier_logistics_override_cents: STATE.supplier_logistics_override_cents,
    combo: COMBO_STATE,
  };
  localStorage.setItem("lpfx_last_os", JSON.stringify(payload));
}

async function loadDraft() {
  const raw = localStorage.getItem("lpfx_last_os");
  if (!raw) return alert("Nenhum rascunho encontrado.");

  const payload = JSON.parse(raw);

  STATE.equipment = payload.equipment || null;
  STATE.selectedServiceIds = new Set(payload.selectedServiceIds || []);
  STATE.selectedParts = payload.selectedParts || [];

  STATE.client_name = payload.client_name || "";
  STATE.client_phone = payload.client_phone || "";
  STATE.client_address = payload.client_address || "";
  STATE.machine_brand = payload.machine_brand || "";
  STATE.machine_model = payload.machine_model || "";
  STATE.notes = payload.notes || "";
  STATE.supplier_logistics_override_cents = payload.supplier_logistics_override_cents ?? null;

  COMBO_STATE = payload.combo || { discountPct: 0, discountedCard: null };

  el("#clientName").value = STATE.client_name;
  el("#clientPhone").value = STATE.client_phone;
  el("#clientAddress").value = STATE.client_address;
  el("#brand").value = STATE.machine_brand;
  el("#model").value = STATE.machine_model;
  el("#notes").value = STATE.notes;

  el("#eqTop").classList.toggle("btnOrange", STATE.equipment === EQUIPMENT_TYPE.TOP_LOAD);
  el("#eqFront").classList.toggle("btnOrange", STATE.equipment === EQUIPMENT_TYPE.LAVA_E_SECA);
  el("#eqRes").classList.toggle("btnOrange", STATE.equipment === EQUIPMENT_TYPE.RESIDENCIAL);

  el("#eqHint").textContent = STATE.equipment
    ? `Catálogo filtrado: ${equipmentLabel(STATE.equipment)}`
    : "Selecione uma opção para carregar.";

  await reloadAll();
}

el("#saveDraft").addEventListener("click", () => {
  saveDraft();
  alert("Rascunho salvo.");
});

el("#loadDraft").addEventListener("click", async () => loadDraft());

el("#newOS").addEventListener("click", () => {
  if (!confirm("Criar nova OS e limpar tudo?")) return;

  STATE.selectedServiceIds = new Set();
  STATE.selectedParts = [];
  STATE.manualServices = [];
  STATE.manualParts = [];
  COMBO_STATE = { discountPct: 0, discountedCard: null };

  STATE.client_name = "";
  STATE.client_phone = "";
  STATE.client_address = "";
  STATE.machine_brand = "";
  STATE.machine_model = "";
  STATE.notes = "";
  STATE.supplier_logistics_override_cents = null;

  el("#clientName").value = "";
  el("#clientPhone").value = "";
  el("#clientAddress").value = "";
  el("#brand").value = "";
  el("#model").value = "";
  el("#notes").value = "";

  renderServiceList();
  renderParts();
  renderSummaries();
  renderManualServices();
  renderManualParts();
});

// =========================
// SAVE OS TO SUPABASE
// =========================
el("#saveOSDb").addEventListener("click", async () => {
  await refreshSession();
  if (!STATE.session) {
    alert("Para salvar no Supabase, faça login primeiro.");
    return;
  }
  if (!STATE.equipment) {
    alert("Selecione o tipo primeiro.");
    return;
  }

  const t = computeTotals();
  if (!t.selectedServices.length) {
    alert("Selecione ao menos 1 serviço.");
    return;
  }

  const diagnosisCharged = t.onlyDiagSelected ? t.diagValue : 0;

  const { data: wo, error: woErr } = await supabase
    .from("work_orders")
    .insert({
      status: "DRAFT",
      client_name: safeText(STATE.client_name) || "Cliente",
      client_phone: safeText(STATE.client_phone) || null,
      client_address: safeText(STATE.client_address) || null,
      equipment_type: STATE.equipment,
      machine_brand: safeText(STATE.machine_brand) || null,
      machine_model: safeText(STATE.machine_model) || null,
      diagnosis_charged_cents: Number(diagnosisCharged || 0),
      diagnosis_credited: false,
      notes: safeText(STATE.notes) || null,
    })
    .select("id")
    .single();

  if (woErr) {
    console.error("work_orders insert:", woErr);
    alert("Erro ao salvar OS (work_orders). Veja o console.");
    return;
  }

  const workOrderId = wo.id;

  const itemsServices = t.selectedServices.map((s) => ({
    work_order_id: workOrderId,
    service_id: s.id,
  }));

  const { error: wosErr } = await supabase.from("work_order_services").insert(itemsServices);
  if (wosErr) {
    console.error("work_order_services insert:", wosErr);
    alert("Erro ao salvar serviços da OS. Veja o console.");
    return;
  }

  if (STATE.selectedParts.length) {
    const itemsParts = STATE.selectedParts.map((p) => ({
      work_order_id: workOrderId,
      part_id: p.part_id,
      part_name: p.part_name,
      sale_price_cents: calcPartSaleCents(p),
      cost_real_cents: Number(p.cost_real_cents || 0),
      margin_percent: Number(p.margin_percent || 40),
      needs_supplier_pickup: !!p.needs_supplier_pickup,
    }));

    const { error: wopErr } = await supabase.from("work_order_parts").insert(itemsParts);
    if (wopErr) {
      console.error("work_order_parts insert:", wopErr);
      alert("Erro ao salvar peças da OS. Veja o console.");
      return;
    }
  }

  saveDraft();
  alert(`OS salva com sucesso! ID: ${workOrderId}\n(Rascunho salvo também.)`);
});

// =========================
// PDF CERTIFICATE (A4 + branding + selo + assinatura)
// =========================
async function generateWarrantyPDF() {
  console.log("[UI] Clique em #genPDF");
  console.log("[PDF] Iniciando geração...");

  const t = computeTotals();

  if (!safeText(STATE.client_name)) {
    alert("Preencha o nome do cliente para gerar o certificado.");
    return;
  }
  if (!t.selectedServices.length) {
    alert("Selecione ao menos 1 serviço.");
    return;
  }

  const warrantyDays = t.warrantyDays || 0;

  // ✅ A4 em mm (layout consistente para impressão)
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  const pageW = doc.internal.pageSize.getWidth();  // 210
  const pageH = doc.internal.pageSize.getHeight(); // 297

  const marginX = 14;
  const headerH = 20;
  const footerH = 22;

  // Pré-carrega assets (cache)
  const [logoData, sealData, signatureData] = await Promise.all([
    getLogoDataUrlSafe(),
    getSealDataUrlSafe(),
    getSignatureDataUrlSafe(),
  ]);

  function drawSoftBadge(x, y, w, h) {
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(x, y, w, h, 2, 2, "F");
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, w, h, 2, 2, "S");
  }

  async function drawHeader() {
    doc.setFillColor(BRAND.orange);
    doc.rect(0, 0, pageW, headerH, "F");

    // logo esquerda (sem distorção)
    if (logoData) {
      const boxX = marginX;
      const boxY = 4;
      const boxW = 36;
      const boxH = 12;
      addImageContain(doc, logoData, boxX, boxY, boxW, boxH, "PNG");
    }

    // selo canto superior direito (equilibrado + destaque leve)
    if (sealData) {
      const sealBoxW = 22;
      const sealBoxH = 22;
      const sealX = pageW - marginX - sealBoxW;
      const sealY = 2.5;

      drawSoftBadge(sealX - 1.2, sealY - 1.2, sealBoxW + 2.4, sealBoxH + 2.4);
      addImageContain(doc, sealData, sealX, sealY, sealBoxW, sealBoxH, "PNG");
    }

    // título (evita conflitar com selo)
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);

    const titleRight = sealData ? pageW - marginX - 26 : pageW - marginX;
    doc.text("CERTIFICADO DE GARANTIA", titleRight, 12, { align: "right" });

    // linha separadora
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.2);
    doc.line(marginX, headerH + 4, pageW - marginX, headerH + 4);

    // reset
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
  }

  function drawFooter() {
    const yLine = pageH - footerH;

    doc.setDrawColor(BRAND.orange);
    doc.setLineWidth(1.0);
    doc.line(marginX, yLine, pageW - marginX, yLine);

    doc.setLineWidth(0.2);
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);

    const leftLines = [
      `WhatsApp: ${COMPANY.whatsapp}`,
      `E-mail: ${COMPANY.email}`,
      COMPANY.address_short,
    ];

    const rightLines = [
      `Instagram: ${COMPANY.instagram}`,
      `Facebook: ${COMPANY.facebook}`,
      `Site: ${COMPANY.site}`,
    ];

    let fy = yLine + 6;
    leftLines.forEach((line) => {
      doc.text(line, marginX, fy);
      fy += 4.2;
    });

    fy = yLine + 6;
    rightLines.forEach((line) => {
      doc.text(line, pageW - marginX, fy, { align: "right" });
      fy += 4.2;
    });

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
  }

  async function newPageWithBrand() {
    doc.addPage();
    await drawHeader();
    drawFooter();
    return headerH + 12;
  }

  await drawHeader();
  drawFooter();

  // Reserva para assinatura (pra não colidir com rodapé)
  const signatureReserveH = signatureData ? 26 : 0;
  const bottomSafe = footerH + 8;
  const pageBottomLimit = () => pageH - bottomSafe - signatureReserveH;

  let y = headerH + 12;

  async function addLine(text, x = marginX) {
    if (y > pageBottomLimit()) y = await newPageWithBrand();
    doc.text(text, x, y);
    y += 7;
  }

  // ===== DADOS DO CLIENTE =====
  doc.setFont("helvetica", "bold");
  await addLine("Dados do Cliente");
  doc.setFont("helvetica", "normal");
  y += 1;

  await addLine(`Data: ${nowISODate()}`);
  await addLine(`Cliente: ${safeText(STATE.client_name)}`);
  if (STATE.client_phone) await addLine(`Telefone: ${safeText(STATE.client_phone)}`);
  if (STATE.client_address) await addLine(`Endereço: ${safeText(STATE.client_address)}`);
  await addLine(`Tipo: ${equipmentLabel(STATE.equipment)}`);
  if (STATE.machine_brand) await addLine(`Marca: ${safeText(STATE.machine_brand)}`);
  if (STATE.machine_model) await addLine(`Modelo: ${safeText(STATE.machine_model)}`);

  y += 3;

  // ===== SERVIÇOS =====
  doc.setFont("helvetica", "bold");
  await addLine("Serviços realizados");
  doc.setFont("helvetica", "normal");
  y += 1;

  for (const s of t.selectedServices) {
    if (y > pageBottomLimit()) y = await newPageWithBrand();
    doc.text(`• ${s.name}`, marginX + 2, y);
    y += 6.5;
  }

  // ===== PEÇAS =====
  if (STATE.selectedParts.length) {
    y += 3;
    doc.setFont("helvetica", "bold");
    await addLine("Peças fornecidas/instaladas");
    doc.setFont("helvetica", "normal");
    y += 1;

    for (const p of STATE.selectedParts) {
      if (y > pageBottomLimit()) y = await newPageWithBrand();
      doc.text(`• ${p.part_name}`, marginX + 2, y);
      y += 6.5;
    }
  }

  // ===== GARANTIA =====
  y += 3;
  doc.setFont("helvetica", "bold");
  await addLine(`Garantia: ${warrantyDays} dias`);
  doc.setFont("helvetica", "normal");
  y += 1;

  const exclusions = [
    "Exclusões: mau uso, queda/instabilidade de energia, alagamento, oxidação,",
    "instalação inadequada, intervenção de terceiros, desgaste natural.",
  ];

  for (const line of exclusions) {
    await addLine(line);
  }

  // ✅ Assinatura digital (remove “Assinatura do Técnico/Cliente”)
  if (signatureData) {
    if (y > pageBottomLimit()) y = await newPageWithBrand();

    const sigBoxW = pageW - marginX * 2;
    const sigBoxH = 18;
    const sigX = marginX;
    const sigY = pageH - bottomSafe - sigBoxH;

    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text("Assinatura oficial do técnico e do responsável LavaProFix", marginX, sigY - 2);
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);

    addImageContain(doc, signatureData, sigX, sigY, sigBoxW, sigBoxH, "PNG");
  }

  const fileName = `garantia-${nowISODate()}-${onlyDigits(STATE.client_phone || "cliente") || "cliente"}.pdf`;

  doc.save(fileName);

  try {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  } catch (e) {
    console.warn("Popup bloqueado. PDF baixado normalmente.", e);
  }

  console.log("[PDF] Gerado com sucesso:", fileName);
}

// =========================
// PDF BUTTON (async safe)
// =========================
function attachPdfButton() {
  const pdfBtn = el("#genPDF");
  if (!pdfBtn) {
    console.warn("Botão #genPDF não encontrado no DOM.");
    return;
  }

  pdfBtn.onclick = async () => {
    try {
      await generateWarrantyPDF();
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
      alert("Erro ao gerar o certificado. Veja o console.");
    }
  };
}

// =========================
// RELOAD ALL
// =========================
async function reloadAll() {
  if (!STATE.equipment) {
    renderSummaries();
    attachPdfButton();
    return;
  }

  await fetchServices();
  await fetchPartsCatalog();
  populatePartsSelect();
  renderServiceList();
  renderParts();
  renderManualServices();
  renderManualParts();
  renderSummaries();
  attachPdfButton();
}

// =========================
// ORÇAMENTO MANUAL (SERVIÇO + PEÇA)
// =========================
function toCentsFromBRL(input) {
  const n = Number(String(input || "").replace(",", ".").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function uid(prefix = "m") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

// ---- Serviço manual
function renderManualServices() {
  const box = el("#manualServicesList");
  if (!box) return;

  if (!STATE.manualServices.length) {
    box.innerHTML = `<div class="hint">Nenhum serviço manual adicionado.</div>`;
    return;
  }

  box.innerHTML = STATE.manualServices.map((s, idx) => `
    <div class="pill">
      <div>
        <div style="font-weight:1000;">${s.name}</div>
        <div class="hint">Valor: <b>${brl(s.labor_base_cents)}</b> • ${s.warranty_days > 0 ? `Garantia ${s.warranty_days} dias` : "Sem garantia"}</div>
      </div>
      <button class="btn" data-act="rmManualSvc" data-i="${idx}">Remover</button>
    </div>
  `).join("");

  box.querySelectorAll("button[data-act='rmManualSvc']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.target.getAttribute("data-i"));
      STATE.manualServices.splice(i, 1);
      renderManualServices();
      renderSummaries();
    });
  });
}

el("#addManualService")?.addEventListener("click", () => {
  const name = safeText(el("#manualSvcName")?.value);
  const valueCents = toCentsFromBRL(el("#manualSvcValue")?.value);
  const warrantyDays = Number(el("#manualSvcWarranty")?.value || 90);

  if (!name) return alert("Digite o nome do serviço manual.");
  if (!valueCents || valueCents <= 0) return alert("Digite um valor válido para o serviço manual.");

  STATE.manualServices.push({
    id: uid("svc"),
    name,
    labor_base_cents: valueCents,
    warranty_days: warrantyDays,
  });

  el("#manualSvcName").value = "";
  el("#manualSvcValue").value = "";

  renderManualServices();
  renderSummaries();
});

// ---- Peça/material manual
function renderManualParts() {
  const box = el("#manualPartsList");
  if (!box) return;

  if (!STATE.manualParts.length) {
    box.innerHTML = `<div class="hint">Nenhuma peça/material manual adicionado.</div>`;
    return;
  }

  box.innerHTML = STATE.manualParts.map((p, idx) => `
    <div class="pill">
      <div>
        <div style="font-weight:1000;">${p.part_name}</div>
        <div class="hint">Venda: <b>${brl(calcPartSaleCents(p))}</b></div>
        <div class="hint" style="opacity:.85;">(interno) custo: ${brl(p.cost_real_cents)} • margem: ${p.margin_percent}%</div>
      </div>
      <button class="btn" data-act="rmManualPart" data-i="${idx}">Remover</button>
    </div>
  `).join("");

  box.querySelectorAll("button[data-act='rmManualPart']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.target.getAttribute("data-i"));
      STATE.manualParts.splice(i, 1);
      renderManualParts();
      renderSummaries();
    });
  });
}

el("#addManualPart")?.addEventListener("click", () => {
  const name = safeText(el("#manualPartName")?.value);
  const costCents = toCentsFromBRL(el("#manualPartCost")?.value);
  const margin = Number(el("#manualPartMargin")?.value || 40);

  if (!name) return alert("Digite o nome da peça/material.");
  if (!costCents || costCents <= 0) return alert("Digite um custo válido (R$).");

  STATE.manualParts.push({
    id: uid("part"),
    part_id: null,
    part_name: name,
    cost_real_cents: costCents,
    margin_percent: margin,
    needs_supplier_pickup: false,
  });

  el("#manualPartName").value = "";
  el("#manualPartCost").value = "";

  renderManualParts();
  renderSummaries();
});

// =========================
// INIT
// =========================
(async function init() {
  await loadConfig();
  await refreshSession();

  attachPdfButton();

  const raw = localStorage.getItem("lpfx_last_os");
  if (raw) {
    try {
      await loadDraft();
      return;
    } catch (e) {
      console.warn("Falha ao carregar rascunho:", e);
    }
  }
  if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js")
      .then(() => console.log("Service Worker registrado"))
      .catch(err => console.error("Erro no SW:", err));
  });
}


  renderSummaries();
})();
