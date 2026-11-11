# Finpess — Aplicativo Android Nativo

Aplicativo oficial Android para o **Finpess (Finanças Inteligentes)** desenvolvido nativamente em **Kotlin** com **Jetpack Compose**, **Material Design 3**, **Room SQLite Database** (offline-first), **WorkManager**, **Retrofit 2** e **Leitor Automático de Notificações Bancárias**.

---

## 📱 Tecnologias & Arquitetura

- **Linguagem:** Kotlin 1.9+ / 2.0 (JVM 17 / 21)
- **UI Moderna:** Jetpack Compose + Material Design 3 (Paleta Granazen: Dark Slate `#0F172A` e Emerald `#059669`)
- **Arquitetura:** MVVM + Clean Architecture + Offline-First (Flow / Coroutines)
- **Banco de Dados Local:** Room SQLite (`launches`, `bank_accounts`, `credit_cards`) com preservação de estado e status de sincronização (`SYNCED`, `PENDING_CREATE`)
- **Sincronizador em Segundo Plano:** WorkManager (`SyncWorker`) com retentativa exponencial e detecção de conectividade
- **Segurança Nativa:** Biometria (`BiometricPrompt` para impressão digital / face unlock) + `EncryptedSharedPreferences` via Android KeyStore (AES-256 GCM)
- **Assistente Bancário:** `NotificationListenerService` inteligente com parsing regex para detectar compras e PIX no Nubank, Inter, Itaú, Bradesco, Santander, C6, Caixa e Banco do Brasil com confirmação em 1-clique!
- **Aritmética Financeira Estrita:** Todos os valores e totais são calculados em centavos inteiros (64-bit integer cents), eliminando qualquer erro de arredondamento de ponto flutuante.

---

## 🗂️ Estrutura de Telas e Módulos

1. **Autenticação Segura:**
   - Tela de Login com validação instantânea, exibição de status e atalho biométrico com 1 toque.
2. **Dashboard Executivo 360°:**
   - Card de Saldo Bancário Consolidado com botão de olho (privacidade).
   - Resumo dinâmico dos 8 módulos (Lançamentos, Recorrentes, Cartões, Dívidas, Empréstimos, Investimentos, Metas e Calendário).
3. **Lançamentos & Extrato:**
   - Navegação mês a mês com balanço de entradas vs saídas.
   - Barra de busca instantânea.
   - ModalBottomSheet para cadastro rápido de despesa ou receita, seleção de conta, categoria e status (confirmado/previsto).
   - Identificação visual de lançamentos offline pendentes de sincronização.
4. **Cartões de Crédito:**
   - Visual moderno de cartões com gradiente, bandeira, últimos 4 dígitos e chip.
   - Fatura aberta atual, barra de progresso do limite e destaque para o Melhor Dia de Compra.
5. **Ajustes & Notificações:**
   - Perfil do usuário logado.
   - Ativação do Leitor de Notificações Bancárias com botão direto para os Ajustes do Android.
   - Chave de ativação de biometria.
   - Botão para forçar sincronização imediata com a nuvem.

---

## 🚀 Como Abrir e Rodar no Android Studio

1. Abra o **Android Studio**.
2. Clique em **File** -> **Open...** e selecione a pasta:  
   `c:\Users\andre_we17otv\OneDrive - z5mh6\Github\finpess\android-app`
3. Aguarde o Android Studio sincronizar o Gradle (`Sync Project with Gradle Files`).
4. Selecione um emulador (AVD) ou conecte seu celular Android via cabo USB (com a opção **Depuração USB** ativada nas Opções do Desenvolvedor).
5. Clique no botão verde de **Play (Run 'app')** ou pressione `Shift + F10`.

---

## 📦 Como Gerar o Arquivo `.apk` Instalável

1. No Android Studio, vá no menu **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**.
2. Ao concluir a compilação, clique no link **locate** na notificação do canto inferior direito.
3. O arquivo `app-debug.apk` estará localizado em:
   `android-app/app/build/outputs/apk/debug/app-debug.apk`
4. Basta enviar o arquivo `.apk` para seu celular via WhatsApp, Telegram, Google Drive ou cabo USB e tocar nele para instalar!
