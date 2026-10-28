use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Errors surfaced by the core engine. Every variant carries a message that is
/// safe to show to an operator (no secrets, no raw SQL).
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unsupported(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Data format error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Archive error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Error::NotFound(_) => "not_found",
            Error::Validation(_) => "validation",
            Error::Conflict(_) => "conflict",
            Error::Unsupported(_) => "unsupported",
            Error::Database(_) => "database",
            Error::Io(_) => "io",
            Error::Json(_) => "format",
            Error::Zip(_) => "archive",
            Error::Other(_) => "other",
        }
    }

    pub fn not_found(what: impl Into<String>) -> Self {
        Error::NotFound(what.into())
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        Error::Validation(msg.into())
    }
}

impl From<csv::Error> for Error {
    fn from(e: csv::Error) -> Self {
        Error::Validation(format!("CSV error: {e}"))
    }
}

impl From<quick_xml::Error> for Error {
    fn from(e: quick_xml::Error) -> Self {
        Error::Validation(format!("XML error: {e}"))
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Error", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type Result<T> = std::result::Result<T, Error>;
