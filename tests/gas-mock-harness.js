/**
 * @file tests/gas-mock-harness.js
 * @description Ambiente de emulação em memória do Google Apps Script V8 (SpreadsheetApp,
 * LockService, PropertiesService, Session, Utilities, CalendarApp, MailApp, HtmlService, ContentService)
 * para execução automatizada e determinística dos testes dos módulos .gs em Node.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function createGasContext(options = {}) {
  const scriptProps = Object.assign({
    OWNER_EMAIL: options.ownerEmail || 'owner@exemplo.local',
    TELEGRAM_WEBHOOK_SECRET: options.webhookSecret || 'segredo_webhook_teste_123456',
    TELEGRAM_BOT_TOKEN: options.botToken || ''
  }, options.scriptProperties || {});

  let activeUserEmail = options.activeUserEmail !== undefined ? options.activeUserEmail : 'owner@exemplo.local';
  let effectiveUserEmail = options.effectiveUserEmail || 'owner@exemplo.local';
  let dailyMailQuota = options.dailyMailQuota !== undefined ? options.dailyMailQuota : 100;
  const sentEmails = [];
  const calendarEvents = {};
  const cacheStore = {};
  const fetchCalls = [];
  const projectTriggers = [];

  // Emulador em memória de Google Sheets
  const sheetsMap = {};

  function createSheetMock(name) {
    const grid = [];

    function ensureSize(rows, cols) {
      while (grid.length < rows) {
        grid.push([]);
      }
      for (let r = 0; r < rows; r++) {
        while (grid[r].length < cols) {
          grid[r].push('');
        }
      }
    }

    return {
      getName: () => name,
      setFrozenRows: () => {},
      getLastRow: () => grid.length,
      getLastColumn: () => (grid.length > 0 ? Math.max(...grid.map(r => r.length), 0) : 0),
      deleteRow: (row1Based) => {
        if (row1Based > 0 && row1Based <= grid.length) {
          grid.splice(row1Based - 1, 1);
        }
      },
      deleteRows: (startRow1Based, numRows = 1) => {
        if (startRow1Based > 0 && startRow1Based <= grid.length) {
          grid.splice(startRow1Based - 1, numRows);
        }
      },
      getRange: (row1Based, col1Based, numRows = 1, numCols = 1) => ({
        getValues: () => {
          ensureSize(row1Based + numRows - 1, col1Based + numCols - 1);
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const rowSlice = [];
            for (let c = 0; c < numCols; c++) {
              const v = grid[row1Based - 1 + r][col1Based - 1 + c];
              rowSlice.push(v === undefined ? '' : v);
            }
            out.push(rowSlice);
          }
          return out;
        },
        setValues: (values2D) => {
          ensureSize(row1Based + values2D.length - 1, col1Based + (values2D[0] ? values2D[0].length : 1) - 1);
          for (let r = 0; r < values2D.length; r++) {
            for (let c = 0; c < values2D[r].length; c++) {
              grid[row1Based - 1 + r][col1Based - 1 + c] = values2D[r][c];
            }
          }
        }
      })
    };
  }

  const activeSpreadsheetMock = {
    getSheetByName: (name) => sheetsMap[name] || null,
    insertSheet: (name) => {
      sheetsMap[name] = createSheetMock(name);
      return sheetsMap[name];
    }
  };

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,

    __setActiveUserEmail: (email) => { activeUserEmail = email; },
    __setScriptProperty: (k, v) => { scriptProps[k] = v; },
    __setMailQuota: (q) => { dailyMailQuota = q; },
    __getSentEmails: () => sentEmails,
    __getFetchCalls: () => fetchCalls,

    CacheService: {
      getScriptCache: () => {
        return {
          get: (k) => (cacheStore[k] !== undefined ? cacheStore[k] : null),
          getAll: (keys) => {
            const out = {};
            (keys || []).forEach(k => { if (cacheStore[k] !== undefined) out[k] = cacheStore[k]; });
            return out;
          },
          put: (k, v, _ttl) => { cacheStore[k] = String(v); },
          putAll: (obj, _ttl) => { Object.assign(cacheStore, obj); },
          remove: (k) => { delete cacheStore[k]; },
          removeAll: (keys) => { (keys || []).forEach(k => delete cacheStore[k]); }
        };
      },
      getUserCache: () => {
        return {
          get: (k) => (cacheStore[k] !== undefined ? cacheStore[k] : null),
          getAll: (keys) => {
            const out = {};
            (keys || []).forEach(k => { if (cacheStore[k] !== undefined) out[k] = cacheStore[k]; });
            return out;
          },
          put: (k, v, _ttl) => { cacheStore[k] = String(v); },
          putAll: (obj, _ttl) => { Object.assign(cacheStore, obj); },
          remove: (k) => { delete cacheStore[k]; },
          removeAll: (keys) => { (keys || []).forEach(k => delete cacheStore[k]); }
        };
      }
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (scriptProps[k] !== undefined ? scriptProps[k] : null),
        setProperty: (k, v) => { scriptProps[k] = String(v); }
      })
    },

    Session: {
      getActiveUser: () => ({ getEmail: () => activeUserEmail }),
      getEffectiveUser: () => ({ getEmail: () => effectiveUserEmail })
    },

    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {}
      })
    },

    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSpreadsheetMock,
      openById: () => activeSpreadsheetMock
    },

    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID(),
      formatDate: (date, _tz, format) => {
        const iso = new Date(date).toISOString();
        if (format === 'yyyy-MM-dd') return iso.substring(0, 10);
        return iso;
      },
      computeDigest: (_alg, str) => {
        const buf = crypto.createHash('sha256').update(String(str), 'utf8').digest();
        return Array.from(buf);
      },
      base64Encode: (bytes) => Buffer.from(bytes || []).toString('base64')
    },

    MailApp: {
      getRemainingDailyQuota: () => dailyMailQuota,
      sendEmail: (msg) => {
        if (dailyMailQuota <= 0) throw new Error('Quota diária de e-mail excedida.');
        dailyMailQuota--;
        sentEmails.push(msg);
      }
    },

    ScriptApp: {
      getService: () => ({
        getUrl: () => 'https://script.google.com/macros/s/AKfycbyzjzX7GYRl-IGmJ0S8kgoCfA9i3G9zC2AuAzUgXFyEYEmrt_ivlaxE2gyul7TCcaAM7g/exec'
      }),
      getProjectTriggers: () => projectTriggers,
      newTrigger: (fnName) => {
        let hourVal = 7;
        let daysVal = 1;
        const builder = {
          timeBased: () => builder,
          everyDays: (d) => { daysVal = d; return builder; },
          atHour: (h) => { hourVal = h; return builder; },
          create: () => {
            const trig = {
              getUniqueId: () => 'trig_' + crypto.randomUUID().substring(0, 8),
              getHandlerFunction: () => fnName,
              hour: hourVal,
              days: daysVal
            };
            projectTriggers.push(trig);
            return trig;
          }
        };
        return builder;
      }
    },

    CalendarApp: {
      getDefaultCalendar: () => ({
        getEventById: (id) => calendarEvents[id] || null,
        createAllDayEvent: (title, date, opts) => {
          const id = 'gcal_ev_' + crypto.randomUUID().substring(0, 8);
          let currentTitle = title;
          let currentDate = date;
          const evObj = {
            getId: () => id,
            getTitle: () => currentTitle,
            setTitle: (t) => { currentTitle = t; },
            setAllDayDate: (d) => { currentDate = d; },
            getAllDayStartDate: () => currentDate,
            opts
          };
          calendarEvents[id] = evObj;
          return evObj;
        }
      }),
      getCalendarById: function () { return this.getDefaultCalendar(); }
    },

    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile: (name) => ({
        evaluate: () => ({
          setTitle: function () { return this; },
          addMetaTag: function () { return this; },
          setXFrameOptionsMode: function () { return this; },
          getContent: () => fs.readFileSync(path.join(__dirname, '..', 'src', name + '.html'), 'utf8')
        })
      }),
      createHtmlOutputFromFile: (name) => ({
        getContent: () => fs.readFileSync(path.join(__dirname, '..', 'src', name + '.html'), 'utf8')
      })
    },

    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({
        setMimeType: function () { return this; },
        getContent: () => txt
      })
    },

    UrlFetchApp: {
      fetch: (url, options = {}) => {
        const urlStr = String(url);
        const fetchRecord = { url: urlStr, options: options || {} };
        fetchCalls.push(fetchRecord);

        let contentObj = {
          candidates: [{
            content: { parts: [{ text: 'Mock Response' }] }
          }],
          models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }]
        };

        if (urlStr.includes('awesomeapi.com.br')) {
          contentObj = {
            USDBRL: { bid: '5.75', pctChange: '0.40' },
            EURBRL: { bid: '6.20', pctChange: '0.20' },
            BTCBRL: { bid: '580000', pctChange: '1.50' }
          };
        } else if (urlStr.includes('bcb.gov.br')) {
          contentObj = [{ data: '06/11/2026', valor: '11.25' }];
        } else if (urlStr.includes('brapi.dev')) {
          contentObj = {
            results: [
              { symbol: 'BBAS3', regularMarketPrice: 27.80, regularMarketChangePercent: 0.85 },
              { symbol: 'TAEE11', regularMarketPrice: 34.20, regularMarketChangePercent: -0.15 },
              { symbol: 'ITUB4', regularMarketPrice: 35.50, regularMarketChangePercent: 1.10 },
              { symbol: 'HGLG11', regularMarketPrice: 163.50, regularMarketChangePercent: 0.30 },
              { symbol: 'KNIP11', regularMarketPrice: 94.80, regularMarketChangePercent: 0.15 },
              { symbol: 'XPML11', regularMarketPrice: 108.20, regularMarketChangePercent: 0.45 },
              { symbol: 'WEGE3', regularMarketPrice: 52.40, regularMarketChangePercent: 1.80 },
              { symbol: 'PRIO3', regularMarketPrice: 43.10, regularMarketChangePercent: 2.15 },
              { symbol: 'IVVB11', regularMarketPrice: 342.00, regularMarketChangePercent: 0.70 },
              { symbol: 'AAPL34', regularMarketPrice: 68.90, regularMarketChangePercent: 1.25 }
            ]
          };
        }

        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(contentObj)
        };
      }
    }
  };

  vm.createContext(sandbox);

  const gsOrder = [
    'DataSanitizationService.gs',
    'SpreadsheetRepository.gs',
    'ValidationService.gs',
    'CacheServiceManager.gs',
    'SecurityLogger.gs',
    'AnomalyDetectionService.gs',
    'IncidentManagementService.gs',
    'NotificationService.gs',
    'AuditService.gs',
    'AuthService.gs',
    'UserService.gs',
    'BankAccountService.gs',
    'CreditCardService.gs',
    'FinanceService.gs',
    'RecurringAccountService.gs',
    'DebtService.gs',
    'LoanService.gs',
    'MarketDataService.gs',
    'InvestmentService.gs',
    'GoalService.gs',
    'ProjectionService.gs',
    'CalendarService.gs',
    'ReportService.gs',
    'OracleService.gs',
    'GeminiService.gs',
    'TelegramAuthService.gs',
    'TelegramParserService.gs',
    'TelegramAudioService.gs',
    'TelegramLaunchService.gs',
    'TelegramWebhookService.gs',
    'SearchService.gs',
    'SetupService.gs',
    'Code.gs'
  ];

  const srcDir = path.join(__dirname, '..', 'src');
  for (const file of gsOrder) {
    const fullPath = path.join(srcDir, file);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }

  return sandbox;
}

module.exports = { createGasContext };

