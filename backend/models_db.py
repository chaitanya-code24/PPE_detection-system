from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy import Boolean
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

SQLALCHEMY_DATABASE_URL = "sqlite:///./users.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(bind=engine)

Base = declarative_base()

# ================= MODELS =================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)


class Violation(Base):
    __tablename__ = "violations"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, index=True)
    label = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)
    username = Column(String)


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class FrameStat(Base):
    __tablename__ = "frame_stats"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    violation = Column(Boolean, default=False)


class SmsConfig(Base):
    __tablename__ = "sms_configs"

    id = Column(Integer, primary_key=True, index=True)
    sender_number = Column(String, default="")
    receiver_number = Column(String, default="")
    enabled = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailConfig(Base):
    __tablename__ = "email_configs"

    id = Column(Integer, primary_key=True, index=True)
    sender_email = Column(String, default="")
    receiver_email = Column(String, default="")
    enabled = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SmsDeliveryLog(Base):
    __tablename__ = "sms_delivery_logs"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, index=True, default="")
    to_number = Column(String, default="")
    message = Column(String, default="")
    status = Column(String, default="failed")  # success | failed
    detail = Column(String, default="")
    provider_id = Column(String, default="")
    is_test = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class EmailDeliveryLog(Base):
    __tablename__ = "email_delivery_logs"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, index=True, default="")
    to_email = Column(String, default="")
    subject = Column(String, default="")
    message = Column(String, default="")
    status = Column(String, default="failed")  # success | failed
    detail = Column(String, default="")
    is_test = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# Create tables
Base.metadata.create_all(bind=engine)
