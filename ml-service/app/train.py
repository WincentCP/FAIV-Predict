"""Model retraining API router and durable background-job lifecycle."""

import datetime
import os
import uuid
from typing import Optional

import psycopg2
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from psycopg2.extras import RealDictCursor

from app.shared import STALE_RETRAIN_JOB_MINUTES, TrainRequest, logger, verify_internal_token
from app.train_pipeline import ModelTrainer

router = APIRouter()


def _fail_stale_retrain_jobs(cur) -> int:
    """Close jobs left non-terminal by an interrupted service process."""
    cur.execute(
        """UPDATE model_retrain_jobs
           SET status = 'failed',
               error_message = 'Training was interrupted by a service restart. Queue retraining again.',
               completed_at = timezone('utc'::text, now()),
               finished_at = timezone('utc'::text, now())
           WHERE status IN ('pending', 'running')
             AND created_at < now() - (%s * interval '1 minute')""",
        (STALE_RETRAIN_JOB_MINUTES,),
    )
    return int(cur.rowcount or 0)


def run_training_job_async(job_id: str, brand_id: Optional[str], niche: Optional[str]):
    """Background task runner for model retraining."""
    logger.info(f"Starting background training job: {job_id}")
    db_url = os.getenv("DATABASE_URL")
    conn = None
    try:
        if db_url:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE model_retrain_jobs SET status = 'running' WHERE id = %s",
                    (job_id,)
                )
                conn.commit()

        # Execute pipeline
        ModelTrainer.run_training(brand_id, niche)

        if db_url and conn:
            with conn.cursor() as cur:
                completed_at = datetime.datetime.now(datetime.timezone.utc)
                cur.execute(
                    """
                    UPDATE model_retrain_jobs
                    SET status = 'success', completed_at = %s, finished_at = %s
                    WHERE id = %s
                    """,
                    (completed_at, completed_at, job_id)
                )
                conn.commit()
            logger.info(f"Background training job {job_id} succeeded.")
    except Exception:
        logger.exception("Background training job %s failed", job_id)
        if db_url and conn:
            try:
                with conn.cursor() as cur:
                    completed_at = datetime.datetime.now(datetime.timezone.utc)
                    cur.execute(
                        """UPDATE model_retrain_jobs
                           SET status = 'failed', error_message = %s,
                               completed_at = %s, finished_at = %s
                           WHERE id = %s""",
                        (
                            "Training failed. Inspect the ML service logs for the cause.",
                            completed_at,
                            completed_at,
                            job_id,
                        )
                    )
                    conn.commit()
            except Exception as inner_e:
                logger.error(f"Failed to record failure in DB for job {job_id}: {inner_e}")
    finally:
        if conn:
            conn.close()


@router.post("/train", dependencies=[Depends(verify_internal_token)])
def train(req: TrainRequest, background_tasks: BackgroundTasks):
    """
    Triggers model retraining. Starts a background thread task to prevent API timeout.
    Returns the retrain job database ID and current state.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise HTTPException(
            status_code=503,
            detail="Cannot queue retraining: DATABASE_URL is not configured.",
        )
    job_id = str(uuid.uuid4())
    resolved_niche = req.niche

    # Register job in DB
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            if req.brand_id:
                cur.execute(
                    """SELECT niche FROM brands
                       WHERE id = %s AND owner_id IS NOT NULL LIMIT 1""",
                    (req.brand_id,),
                )
                brand = cur.fetchone()
                if not brand:
                    raise HTTPException(status_code=404, detail="Brand was not found.")
                resolved_niche = brand[0]
            reconciled_jobs = _fail_stale_retrain_jobs(cur)
            if reconciled_jobs:
                logger.warning(
                    "Marked %s interrupted retraining job(s) as failed before queueing.",
                    reconciled_jobs,
                )
            cur.execute(
                """
                INSERT INTO model_retrain_jobs (id, brand_id, status, created_at)
                VALUES (%s, %s, 'pending', %s)
                """,
                (job_id, req.brand_id, datetime.datetime.now(datetime.timezone.utc))
            )
            conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to record retrain job in database: {e}")
        raise HTTPException(status_code=503, detail="Cannot queue retraining: job store is unavailable.")
    finally:
        if conn:
            conn.close()

    # Run in background
    background_tasks.add_task(
        run_training_job_async, job_id, req.brand_id, resolved_niche
    )

    return {
        "status": "pending",
        "job_id": job_id,
        "message": "Retraining job queued successfully in background."
    }


@router.get("/train/{job_id}", dependencies=[Depends(verify_internal_token)])
def get_train_status(job_id: str):
    """Retrieves the status of a background retraining job from database."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        # Never fabricate a completed job: without a database there is no job state.
        raise HTTPException(
            status_code=503,
            detail="Job status unavailable: DATABASE_URL is not configured."
        )
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT status, error_message, created_at, completed_at FROM model_retrain_jobs WHERE id = %s",
                (job_id,)
            )
            row = cur.fetchone()
            if row:
                res = dict(row)
                # Parse datetime objects for JSON serialization
                if res.get("created_at"):
                    res["created_at"] = res["created_at"].isoformat()
                if res.get("completed_at"):
                    res["completed_at"] = res["completed_at"].isoformat()
                return res
            raise HTTPException(status_code=404, detail="Job not found")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to query train status")
        raise HTTPException(
            status_code=503,
            detail="Job status is temporarily unavailable.",
        )
    finally:
        if conn:
            conn.close()
