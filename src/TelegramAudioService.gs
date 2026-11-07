/**
 * @file TelegramAudioService.gs
 * @description Processamento seguro de mensagens de voz e áudio do Telegram.
 * Baixa o áudio apenas em memória volátil, aciona o serviço de transcrição,
 * converte em proposta estruturada validada e descarta o áudio imediatamente.
 */

var TelegramAudioService = (function () {
  var MAX_DURATION_SECONDS = 180;
  var MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
  var ALLOWED_MIME_PREFIXES = ['audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/x-m4a'];

  function validateAudioMetadata(audioMeta) {
    if (!audioMeta || !audioMeta.file_id) {
      throw new Error('AUDIO_INVALID_META: Identificador do arquivo de áudio ausente.');
    }
    if (audioMeta.duration !== undefined && Number(audioMeta.duration) > MAX_DURATION_SECONDS) {
      throw new Error('AUDIO_TOO_LONG: O áudio excede o limite máximo de ' + MAX_DURATION_SECONDS + ' segundos.');
    }
    if (audioMeta.file_size !== undefined && Number(audioMeta.file_size) > MAX_FILE_SIZE_BYTES) {
      throw new Error('AUDIO_TOO_LARGE: O arquivo de áudio excede o tamanho máximo permitido de 10 MB.');
    }
    if (audioMeta.mime_type) {
      var mime = String(audioMeta.mime_type).toLowerCase();
      var validMime = false;
      for (var i = 0; i < ALLOWED_MIME_PREFIXES.length; i++) {
        if (mime.indexOf(ALLOWED_MIME_PREFIXES[i]) === 0) {
          validMime = true;
          break;
        }
      }
      if (!validMime) {
        throw new Error('AUDIO_UNSUPPORTED_FORMAT: Formato de áudio não suportado (' + audioMeta.mime_type + ').');
      }
    }
    return true;
  }

  /**
   * Obtém os bytes em base64 do arquivo de áudio no Telegram apenas em memória.
   */
  function downloadTelegramAudioInMemory(fileId, options) {
    var opts = options || {};
    if (opts.mockAudioBase64) {
      return {
        base64: opts.mockAudioBase64,
        mimeType: opts.mimeType || 'audio/ogg'
      };
    }

    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var botToken = props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '';
    if (!botToken || typeof UrlFetchApp === 'undefined') {
      throw new Error('TELEGRAM_TOKEN_MISSING: Token do bot não configurado para download de áudio.');
    }

    var getFileUrl = 'https://api.telegram.org/bot' + botToken + '/getFile?file_id=' + encodeURIComponent(fileId);
    var metaResp = UrlFetchApp.fetch(getFileUrl, { muteHttpExceptions: true });
    if (metaResp.getResponseCode() !== 200) {
      throw new Error('TELEGRAM_GETFILE_ERROR: Não foi possível consultar o arquivo de áudio no Telegram.');
    }
    var metaJson = JSON.parse(metaResp.getContentText());
    if (!metaJson || !metaJson.ok || !metaJson.result || !metaJson.result.file_path) {
      throw new Error('TELEGRAM_FILE_PATH_MISSING: Caminho do arquivo de áudio indisponível.');
    }

    var fileUrl = 'https://api.telegram.org/file/bot' + botToken + '/' + metaJson.result.file_path;
    var fileResp = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true });
    if (fileResp.getResponseCode() !== 200) {
      throw new Error('TELEGRAM_DOWNLOAD_ERROR: Falha ao baixar o conteúdo do áudio.');
    }

    var bytes = fileResp.getContent();
    var base64 = Utilities.base64Encode(bytes);
    // Descarta referência explícita aos bytes brutos após codificação em memória
    bytes = null;

    return {
      base64: base64,
      mimeType: opts.mimeType || 'audio/ogg'
    };
  }

  /**
   * Baixa qualquer arquivo (como fotos de cupons fiscais) do Telegram em memória volátil.
   */
  function downloadTelegramFileInMemory(fileId, defaultMimeType, options) {
    var opts = options || {};
    if (opts.mockFileBase64) {
      return {
        base64: opts.mockFileBase64,
        mimeType: opts.mimeType || defaultMimeType || 'image/jpeg'
      };
    }

    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var botToken = props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '';
    if (!botToken || typeof UrlFetchApp === 'undefined') {
      throw new Error('TELEGRAM_TOKEN_MISSING: Token do bot não configurado para download de arquivo.');
    }

    var getFileUrl = 'https://api.telegram.org/bot' + botToken + '/getFile?file_id=' + encodeURIComponent(fileId);
    var metaResp = UrlFetchApp.fetch(getFileUrl, { muteHttpExceptions: true });
    if (metaResp.getResponseCode() !== 200) {
      throw new Error('TELEGRAM_GETFILE_ERROR: Não foi possível consultar o arquivo no Telegram.');
    }
    var metaJson = JSON.parse(metaResp.getContentText());
    if (!metaJson || !metaJson.ok || !metaJson.result || !metaJson.result.file_path) {
      throw new Error('TELEGRAM_FILE_PATH_MISSING: Caminho do arquivo indisponível.');
    }

    var filePath = metaJson.result.file_path;
    var mime = defaultMimeType || 'image/jpeg';
    if (/\.png$/i.test(filePath)) mime = 'image/png';
    else if (/\.webp$/i.test(filePath)) mime = 'image/webp';
    else if (/\.ogg$/i.test(filePath)) mime = 'audio/ogg';
    else if (/\.mp3$/i.test(filePath)) mime = 'audio/mpeg';

    var fileUrl = 'https://api.telegram.org/file/bot' + botToken + '/' + filePath;
    var fileResp = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true });
    if (fileResp.getResponseCode() !== 200) {
      throw new Error('TELEGRAM_DOWNLOAD_ERROR: Falha ao baixar o arquivo.');
    }

    var bytes = fileResp.getContent();
    var base64 = Utilities.base64Encode(bytes);
    bytes = null;

    return {
      base64: base64,
      mimeType: opts.mimeType || mime
    };
  }

  /**
   * Processa uma mensagem de voz ou áudio de ponta a ponta até a estruturação da proposta,
   * sem gravar o lançamento automaticamente e sem reter o arquivo de áudio.
   */
  function processAudioMessage(user, audioMeta, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    validateAudioMetadata(audioMeta);
    var opts = options || {};

    var audioData = null;
    if (typeof opts.mockTranscript !== 'string' && !opts.simulateTranscriptionFailure) {
      audioData = downloadTelegramAudioInMemory(audioMeta.file_id, {
        mockAudioBase64: opts.mockAudioBase64,
        mimeType: audioMeta.mime_type || 'audio/ogg'
      });
    }

    var sttResult = GeminiService.transcribeAudioBytes(
      audioData ? audioData.base64 : '',
      (audioData && audioData.mimeType) || audioMeta.mime_type || 'audio/ogg',
      opts
    );

    // Libera imediatamente o buffer de áudio da memória (política de retenção zero de áudio)
    audioData = null;

    var transcript = ValidationService.sanitizeText(sttResult.transcricao, 500);
    if (!transcript || transcript.length < 3) {
      throw new Error('AUDIO_INAUDIBLE: Áudio inaudível ou sem informações financeiras compreensíveis.');
    }

    var extracted = TelegramParserService.parseNaturalLanguageLaunch(user, transcript, {
      referenceDateIso: opts.referenceDateIso
    });

    return {
      extracted: extracted,
      provedor_transcricao: sttResult.provedor
    };
  }

  return {
    MAX_DURATION_SECONDS: MAX_DURATION_SECONDS,
    MAX_FILE_SIZE_BYTES: MAX_FILE_SIZE_BYTES,
    validateAudioMetadata: validateAudioMetadata,
    downloadTelegramAudioInMemory: downloadTelegramAudioInMemory,
    downloadTelegramFileInMemory: downloadTelegramFileInMemory,
    processAudioMessage: processAudioMessage
  };
})();

