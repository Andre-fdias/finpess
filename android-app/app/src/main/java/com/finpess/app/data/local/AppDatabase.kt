package com.finpess.app.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.finpess.app.data.local.dao.BankAccountDao
import com.finpess.app.data.local.dao.CreditCardDao
import com.finpess.app.data.local.dao.LaunchDao
import com.finpess.app.data.local.entity.BankAccountEntity
import com.finpess.app.data.local.entity.CreditCardEntity
import com.finpess.app.data.local.entity.LaunchEntity
import com.finpess.app.data.local.entity.SyncStatus

class Converters {
    @TypeConverter
    fun fromSyncStatus(status: SyncStatus): String = status.name

    @TypeConverter
    fun toSyncStatus(value: String): SyncStatus = try {
        SyncStatus.valueOf(value)
    } catch (e: Exception) {
        SyncStatus.SYNCED
    }
}

@Database(
    entities = [
        LaunchEntity::class,
        CreditCardEntity::class,
        BankAccountEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun launchDao(): LaunchDao
    abstract fun creditCardDao(): CreditCardDao
    abstract fun bankAccountDao(): BankAccountDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "finpess_database"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}

