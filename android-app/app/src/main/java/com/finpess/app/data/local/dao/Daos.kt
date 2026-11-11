package com.finpess.app.data.local.dao

import androidx.room.*
import com.finpess.app.data.local.entity.LaunchEntity
import com.finpess.app.data.local.entity.SyncStatus
import kotlinx.coroutines.flow.Flow

@Dao
interface LaunchDao {
    @Query("SELECT * FROM launches ORDER BY data DESC, id DESC")
    fun getAllFlow(): Flow<List<LaunchEntity>>

    @Query("SELECT * FROM launches WHERE data LIKE :yearMonth || '%' ORDER BY data DESC, id DESC")
    fun getByMonthFlow(yearMonth: String): Flow<List<LaunchEntity>>

    @Query("SELECT * FROM launches WHERE syncStatus != 'SYNCED'")
    suspend fun getPendingSync(): List<LaunchEntity>

    @Query("SELECT * FROM launches WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): LaunchEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(launch: LaunchEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(launches: List<LaunchEntity>)

    @Update
    suspend fun update(launch: LaunchEntity)

    @Query("DELETE FROM launches WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM launches WHERE syncStatus = 'SYNCED'")
    suspend fun clearSynced()
}

@Dao
interface CreditCardDao {
    @Query("SELECT * FROM credit_cards ORDER BY nome ASC")
    fun getAllFlow(): Flow<List<com.finpess.app.data.local.entity.CreditCardEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(cards: List<com.finpess.app.data.local.entity.CreditCardEntity>)

    @Query("DELETE FROM credit_cards")
    suspend fun clearAll()
}

@Dao
interface BankAccountDao {
    @Query("SELECT * FROM bank_accounts ORDER BY nome ASC")
    fun getAllFlow(): Flow<List<com.finpess.app.data.local.entity.BankAccountEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(accounts: List<com.finpess.app.data.local.entity.BankAccountEntity>)

    @Query("DELETE FROM bank_accounts")
    suspend fun clearAll()
}

