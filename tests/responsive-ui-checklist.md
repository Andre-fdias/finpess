# Checklist e Verificação de Interface Responsiva e Temas (Desktop, Tablet e Android)

## 1. Compatibilidade Multiplataforma Verificada

### Computador (Windows, Linux, macOS — `>= 1024px`)
- [x] Sidebar lateral fixa/recolhível (`grid-template-columns: 260px minmax(0, 1fr)`).
- [x] Área de conteúdo ampla (`max-width: 1440px`).
- [x] Tabelas detalhadas com valores alinhados à direita e fonte numérica tabular (`font-variant-numeric: tabular-nums`).
- [x] Dashboard com 2 linhas de KPIs (4 colunas) separando valores Confirmados, Previstos, Pendentes e Estimados.
- [x] Formulários distribuídos em 3 colunas (`.form-grid`).

### Tablet (Android e iPad — `768px` a `1023px`)
- [x] Navegação adaptável (`210px` + área flexível).
- [x] Cards reorganizados em 2 colunas (`grid-template-columns: repeat(2, minmax(0, 1fr))`).
- [x] Campos de formulário e botões dimensionados para toque (`min-height: 44px`).
- [x] Tabelas com contêiner `.table-responsive` (`overflow-x: auto`) sem perda de informações.

### Celular Android (`< 768px`)
- [x] Barra de navegação inferior fixa (`.mobile-bottom-nav`) com acesso rápido a Início, Lançar, Agenda, Oráculo e Mais, além de menu gaveta (`.sidebar.mobile-open`).
- [x] Cards empilhados verticalmente em 1 coluna (`grid-template-columns: minmax(0, 1fr)`).
- [x] Botões e campos adequados para toque (`min-height: 48px`, `font-size: 1rem`).
- [x] Formulários em 1 coluna.
- [x] Zero rolagem horizontal da página (`html, body { max-width: 100vw; overflow-x: hidden; }`).
- [x] Modal de confirmação explícito (`#confirm-modal-backdrop`) antes de operações financeiras destrutivas ou confirmações.

## 2. Temas Claro (Light Mode), Escuro (Dark Mode) e Automático

- [x] Variáveis CSS centralizadas em `src/Styles.html` para `[data-theme="light"]`, `[data-theme="dark"]` e `@media (prefers-color-scheme: dark)` para `[data-theme="auto"]`.
- [x] Seletor rápido no topo da aplicação (`#topbar-theme-select`) e nas Configurações (`#pref-tema`).
- [x] Persistência vinculada ao usuário autenticado na aba `USUARIOS.tema_preferido` via rota `user.updateTheme`, prevalecendo sobre a configuração automática do dispositivo.
- [x] Gráfico SVG mensal (`UIHelpers.renderMonthlyBarChartSvg`) utilizando tokens `var(--success)`, `var(--danger)`, `var(--text-secondary)` e `var(--chart-grid)` compatíveis com ambos os temas.

