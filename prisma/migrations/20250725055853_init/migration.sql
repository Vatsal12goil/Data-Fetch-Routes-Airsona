/*
  Warnings:

  - You are about to drop the `FetchedData` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "FetchedData";

-- CreateTable
CREATE TABLE "AQIStation" (
    "id" SERIAL NOT NULL,
    "location" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "aqi" INTEGER,
    "pm25" DOUBLE PRECISION,
    "pm10" DOUBLE PRECISION,
    "o3" DOUBLE PRECISION,
    "no2" DOUBLE PRECISION,
    "so2" DOUBLE PRECISION,
    "co" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AQIStation_pkey" PRIMARY KEY ("id")
);
