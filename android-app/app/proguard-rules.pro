# Proguard rules for Finpess
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.finpess.app.data.model.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
