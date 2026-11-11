package com.finpess.app

import android.app.Application
import com.finpess.app.data.sync.SyncWorker

class FinpessApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        SyncWorker.schedulePeriodicSync(this)
    }

    companion object {
        lateinit var instance: FinpessApplication
            private set
    }
}
