-- CreateTable
CREATE TABLE "FetchedData" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchedData_pkey" PRIMARY KEY ("id")
);
