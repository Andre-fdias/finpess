package com.finpess.app.data.repository

import com.finpess.app.core.Result
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.local.AppDatabase
import com.finpess.app.data.local.entity.BankAccountEntity
import com.finpess.app.data.local.entity.CreditCardEntity
import com.finpess.app.data.local.entity.LaunchEntity
import com.finpess.app.data.local.entity.SyncStatus
import com.finpess.app.data.model.*
import com.finpess.app.data.remote.FinpessApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.util.UUID

class TransactionRepository(
    private val apiService: FinpessApiService,
    private val database: AppDatabase,
    private val securityManager: SecurityManager
) {
    private val launchDao = database.launchDao()
    private val bankAccountDao = database.bankAccountDao()
    private val creditCardDao = database.creditCardDao()

    fun getLocalLaunchesFlow(yearMonth: String?): Flow<List<LaunchEntity>> {
        return if (yearMonth != null) {
            launchDao.getByMonthFlow(yearMonth)
        } else {
            launchDao.getAllFlow()
        }
    }

    fun getLocalBankAccountsFlow(): Flow<List<BankAccountEntity>> = bankAccountDao.getAllFlow()
    fun getLocalCreditCardsFlow(): Flow<List<CreditCardEntity>> = creditCardDao.getAllFlow()

    suspend fun refreshLaunches(yearMonth: String?): Result<List<LaunchEntity>> = withContext(Dispatchers.IO) {
        val token = securityManager.getSessionToken()
        if (token.isNullOrBlank()) {
            return@withContext Result.Error("Usuário não autenticado.")
        }

        try {
            val response = apiService.getLaunches(
                LaunchesListRequest(
                    payload = LaunchesListFilterPayload(mesReferencia = yearMonth),
                    authContext = AuthContextDto(sessionToken = token)
                )
            )

            if (response.isSuccessful && response.body()?.ok == true) {
                val remoteList = response.body()?.data ?: emptyList()
                val entities = remoteList.map { dto ->
                    LaunchEntity(
                        id = dto.id,
                        data = dto.dataLancamento,
                        tipo = dto.tipo,
                        descricao = dto.descricao,
                        categoria = dto.categoriaNome ?: "Geral",
                        subcategoria = dto.subcategoriaNome,
                        valorCentavos = dto.valorCentavos,
                        status = dto.situacao,
                        contaId = dto.contaBancariaId,
                        contaNome = dto.contaBancariaNome,
                        formaPagamento = dto.formaPagamento,
                        observacao = dto.observacao,
                        syncStatus = SyncStatus.SYNCED
                    )
                }

                // Preserva lançamentos pendentes de sincronização local
                val pending = launchDao.getPendingSync()
                launchDao.clearSynced()
                launchDao.insertAll(entities)
                launchDao.insertAll(pending)

                Result.Success(entities)
            } else {
                val errorMsg = response.body()?.error ?: "Falha ao obter lançamentos (${response.code()})"
                Result.Error(errorMsg)
            }
        } catch (e: Exception) {
            // Em caso de falta de conexão ou erro de rede, usa o banco de dados Room local
            Result.Error(e.message ?: "Erro de conexão ao carregar lançamentos")
        }
    }

    suspend fun refreshAccountsAndCards(): Result<Unit> = withContext(Dispatchers.IO) {
        val token = securityManager.getSessionToken() ?: return@withContext Result.Error("Não autenticado")
        try {
            val accResponse = apiService.getBankAccounts(BankAccountsListRequest(authContext = AuthContextDto(sessionToken = token)))
            if (accResponse.isSuccessful && accResponse.body()?.ok == true) {
                val accList = accResponse.body()?.data ?: emptyList()
                val accEntities = accList.map {
                    BankAccountEntity(
                        id = it.id,
                        nome = it.nome,
                        instituicao = it.instituicao,
                        tipo = it.tipoConta,
                        saldoCentavos = it.saldoAtualCentavos,
                        corHex = it.corHex
                    )
                }
                bankAccountDao.clearAll()
                bankAccountDao.insertAll(accEntities)
            }

            val cardResponse = apiService.getCreditCards(CreditCardsListRequest(authContext = AuthContextDto(sessionToken = token)))
            if (cardResponse.isSuccessful && cardResponse.body()?.ok == true) {
                val cardList = cardResponse.body()?.data ?: emptyList()
                val cardEntities = cardList.map {
                    CreditCardEntity(
                        id = it.id,
                        nome = it.nome,
                        bandeira = it.bandeira,
                        finalCartao = it.ultimosQuatroDigitos,
                        diaFechamento = it.diaFechamento,
                        diaVencimento = it.diaVencimento,
                        limiteTotalCentavos = it.limiteTotalCentavos,
                        limiteDisponivelCentavos = it.limiteDisponivelCentavos,
                        faturaAtualCentavos = it.faturaAtualCentavos,
                        corHex = it.corHex
                    )
                }
                creditCardDao.clearAll()
                creditCardDao.insertAll(cardEntities)
            }
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e.message ?: "Erro ao atualizar contas e cartões")
        }
    }

    suspend fun createLaunch(
        tipo: String,
        descricao: String,
        valorCentavos: Long,
        data: String,
        contaId: String,
        contaNome: String?,
        categoriaId: String,
        categoriaNome: String?,
        situacao: String = "CONFIRMADO",
        formaPagamento: String = "PIX",
        observacao: String? = null
    ): Result<LaunchEntity> = withContext(Dispatchers.IO) {
        val clientExternalId = UUID.randomUUID().toString()
        val localLaunch = LaunchEntity(
            id = clientExternalId,
            data = data,
            tipo = tipo,
            descricao = descricao,
            categoria = categoriaNome ?: "Geral",
            valorCentavos = valorCentavos,
            status = situacao,
            contaId = contaId,
            contaNome = contaNome,
            formaPagamento = formaPagamento,
            observacao = observacao,
            syncStatus = SyncStatus.PENDING_CREATE
        )

        // 1. Salva imediatamente no Room local para responsividade offline instantânea
        launchDao.insert(localLaunch)

        // 2. Tenta sincronizar com o backend
        val token = securityManager.getSessionToken()
        if (!token.isNullOrBlank()) {
            try {
                val response = apiService.createLaunch(
                    CreateLaunchRequest(
                        payload = CreateLaunchPayload(
                            tipo = tipo,
                            descricao = descricao,
                            valorCentavos = valorCentavos,
                            dataLancamento = data,
                            situacao = situacao,
                            contaBancariaId = contaId,
                            categoriaId = categoriaId,
                            formaPagamento = formaPagamento,
                            observacao = observacao,
                            idOrigemExterna = clientExternalId
                        ),
                        authContext = AuthContextDto(sessionToken = token)
                    )
                )

                if (response.isSuccessful && response.body()?.ok == true) {
                    val serverData = response.body()?.data
                    if (serverData != null) {
                        launchDao.deleteById(clientExternalId)
                        val confirmedEntity = localLaunch.copy(
                            id = serverData.id,
                            syncStatus = SyncStatus.SYNCED
                        )
                        launchDao.insert(confirmedEntity)
                        return@withContext Result.Success(confirmedEntity)
                    }
                }
            } catch (e: Exception) {
                // Permanecerá como PENDING_CREATE para ser sincronizado pelo SyncWorker em segundo plano
            }
        }

        Result.Success(localLaunch)
    }

    suspend fun syncPendingLaunches(): Int = withContext(Dispatchers.IO) {
        val pending = launchDao.getPendingSync()
        if (pending.isEmpty()) return@withContext 0

        val token = securityManager.getSessionToken() ?: return@withContext 0
        var syncedCount = 0

        for (item in pending) {
            try {
                val response = apiService.createLaunch(
                    CreateLaunchRequest(
                        payload = CreateLaunchPayload(
                            tipo = item.tipo,
                            descricao = item.descricao,
                            valorCentavos = item.valorCentavos,
                            dataLancamento = item.data,
                            situacao = item.status,
                            contaBancariaId = item.contaId ?: "",
                            categoriaId = item.categoria,
                            formaPagamento = item.formaPagamento ?: "PIX",
                            observacao = item.observacao,
                            idOrigemExterna = item.id
                        ),
                        authContext = AuthContextDto(sessionToken = token)
                    )
                )

                if (response.isSuccessful && response.body()?.ok == true) {
                    val serverData = response.body()?.data
                    if (serverData != null) {
                        launchDao.deleteById(item.id)
                        launchDao.insert(item.copy(id = serverData.id, syncStatus = SyncStatus.SYNCED))
                        syncedCount++
                    }
                }
            } catch (e: Exception) {
                // Tenta no próximo ciclo
            }
        }
        syncedCount
    }
}
